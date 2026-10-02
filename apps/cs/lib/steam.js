const PRODUCTION_INTERFACE = 'ISteamMicroTxn';
const SANDBOX_INTERFACE = 'ISteamMicroTxnSandbox';
const BASE_URL = 'https://partner.steam-api.com';
const UPSTREAM_ERROR_STATUS = 424;

export class SteamApiError extends Error {
  constructor(message, { errorCode = null, statusCode = UPSTREAM_ERROR_STATUS, upstreamStatus = null } = {}) {
    super(message);
    this.name = 'SteamApiError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
  }
}

export function createSteamClient({ publisherKey, appId, useSandbox, timeoutMs = 12_000 }) {
  const interfaceName = useSandbox ? SANDBOX_INTERFACE : PRODUCTION_INTERFACE;

  async function request(path, { method = 'GET', params = {} } = {}) {
    const url = new URL(`${BASE_URL}/${interfaceName}/${path}`);
    const requestOptions = {
      method,
      headers: {
        Accept: 'application/json',
        'x-webapi-key': publisherKey
      },
      signal: AbortSignal.timeout(timeoutMs)
    };

    if (method === 'GET') {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    } else {
      requestOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded; charset=UTF-8';
      requestOptions.body = new URLSearchParams(params).toString();
    }

    let response;
    try {
      response = await fetch(url, requestOptions);
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw new SteamApiError('Steam API 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.');
      }

      throw new SteamApiError('Steam API에 연결하지 못했습니다. 서버 네트워크 상태를 확인해 주세요.');
    }

    const contentType = response.headers.get('content-type') || '';
    const responseText = await response.text();
    let payload = null;

    if (responseText.trim()) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const steamResponse = payload?.response;
      const errorCode = steamResponse?.error?.errorcode ?? null;
      const description = steamResponse?.error?.errordesc;

      if (description) {
        throw new SteamApiError(description, {
          errorCode,
          upstreamStatus: response.status
        });
      }

      if (response.status === 401 || response.status === 403) {
        throw new SteamApiError(
          `Steam API 인증이 거부되었습니다. Publisher Key, Microtransactions 권한, App ID 그룹 연결, IP 허용 목록을 확인하세요. (HTTP ${response.status})`,
          { upstreamStatus: response.status }
        );
      }

      throw new SteamApiError(`Steam API HTTP 오류가 발생했습니다. (HTTP ${response.status})`, {
        upstreamStatus: response.status
      });
    }

    if (!payload) {
      const responseKind = contentType || '알 수 없음';
      throw new SteamApiError(
        `Steam API가 JSON이 아닌 응답을 반환했습니다. 응답 형식: ${responseKind}, HTTP ${response.status}`,
        { upstreamStatus: response.status }
      );
    }

    const steamResponse = payload?.response;
    if (!steamResponse || steamResponse.result !== 'OK') {
      const errorCode = steamResponse?.error?.errorcode ?? null;
      const description = steamResponse?.error?.errordesc || 'Steam에서 요청을 처리하지 못했습니다.';
      throw new SteamApiError(description, { errorCode, upstreamStatus: response.status });
    }

    return steamResponse.params ?? {};
  }

  async function queryBy(identifierType, identifier) {
    const params = await request('QueryTxn/v3/', {
      method: 'GET',
      params: {
        appid: appId,
        [identifierType]: identifier
      }
    });

    return {
      ...normalizeTransaction(params),
      lookupType: identifierType
    };
  }

  return {
    async queryTransaction(identifier) {
      try {
        return await queryBy('orderid', identifier);
      } catch (orderError) {
        if (!(orderError instanceof SteamApiError) || orderError.upstreamStatus !== 400) {
          throw orderError;
        }

        try {
          return await queryBy('transid', identifier);
        } catch (transactionError) {
          if (transactionError instanceof SteamApiError && transactionError.upstreamStatus === 400) {
            throw new SteamApiError(
              '입력한 번호를 Order ID와 Steam Transaction ID 양쪽으로 조회했지만 거래를 찾지 못했습니다. 번호와 App ID를 확인하세요. (HTTP 400)',
              { upstreamStatus: 400 }
            );
          }

          throw transactionError;
        }
      }
    },

    async refundTransaction(orderId) {
      const params = await request('RefundTxn/v2/', {
        method: 'POST',
        params: {
          appid: appId,
          orderid: orderId
        }
      });

      return {
        orderId: String(params.orderid ?? orderId),
        transactionId: String(params.transid ?? '')
      };
    },

    async getTransactionReport(time, maxResults = 10_000) {
      const params = await request('GetReport/v5/', {
        method: 'GET',
        params: {
          appid: appId,
          time,
          maxresults: String(maxResults)
        }
      });
      const rawOrders = Array.isArray(params.orders)
        ? params.orders
        : params.orders
          ? [params.orders]
          : [];
      return rawOrders.map(normalizeTransaction);
    }
  };
}

export function normalizeTransaction(params) {
  const rawItems = Array.isArray(params?.items)
    ? params.items
    : params?.items
      ? [params.items]
      : [];

  return {
    orderId: String(params?.orderid ?? ''),
    transactionId: String(params?.transid ?? ''),
    steamId: String(params?.steamid ?? ''),
    status: String(params?.status ?? ''),
    currency: String(params?.currency ?? ''),
    country: String(params?.country ?? ''),
    time: String(params?.time ?? params?.timecreated ?? ''),
    items: rawItems.map((item) => ({
      itemId: String(item?.itemid ?? ''),
      quantity: String(item?.qty ?? item?.quantity ?? ''),
      amount: String(item?.amount ?? ''),
      vat: String(item?.vat ?? ''),
      status: String(item?.itemstatus ?? item?.status ?? '')
    }))
  };
}
