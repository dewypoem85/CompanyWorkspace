// Used only by the isolated production-entrypoint test via node --import.
// No network fallback: an unexpected request fails instead of contacting Azure.
globalThis.fetch = async input => {
  const url = new URL(typeof input === 'string' ? input : input.url || input);
  if (url.origin !== 'https://storagefixture.blob.core.windows.net' || url.searchParams.get('comp') !== 'list') {
    throw new Error('Unexpected external request in isolated statistics test');
  }
  await new Promise(resolve => setTimeout(resolve, 50));
  return new Response('<EnumerationResults><Blobs></Blobs><NextMarker /></EnumerationResults>', {
    status: 200, headers: { 'Content-Type': 'application/xml' }
  });
};
