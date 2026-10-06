import { useState } from 'react';
import { SmartTranslatorView } from './SmartTranslatorView';
import { SettingsView, SETTINGS_TABS, SETTINGS_TAB_KEY, readSavedTab, type SettingsTab } from './SettingsView';
import { GlossaryView } from './GlossaryView';

export function App() {
  const [activeMenu, setActiveMenu] = useState<'main' | 'test' | 'glossary' | 'settings'>('main');
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>(readSavedTab);
  const [settingsDirty, setSettingsDirty] = useState<Record<SettingsTab, boolean>>({ connection: false, ai: false, schedule: false });

  // 환경 설정의 서브 메뉴 선택 (저장하지 않은 변경이 있으면 이동 전에 확인)
  const openSettings = (tab?: SettingsTab) => {
    const next = tab ?? settingsTab;
    if (next !== settingsTab) {
      if (activeMenu === 'settings' && settingsDirty[settingsTab]) {
        const label = SETTINGS_TABS.find((t) => t.id === settingsTab)?.label;
        const ok = window.confirm(
          `'${label}'에 저장하지 않은 변경이 있습니다.\n이동해도 입력한 내용은 유지되지만 저장되지는 않습니다. 이동할까요?`
        );
        if (!ok) return;
      }
      setSettingsTab(next);
      try {
        window.localStorage.setItem(SETTINGS_TAB_KEY, next);
      } catch {}
    }
    setActiveMenu('settings');
  };

  const triggerRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleMenuChange = (menu: 'main' | 'test' | 'glossary' | 'settings') => {
    setActiveMenu(menu);
    if (menu === 'main' || menu === 'test') {
      triggerRefresh();
    }
  };

  return (
    <div className="app-shell">
      {/* 사이드바 */}
      <aside className="sidebar">
        <div className="brand-header">
          <img
            src="https://company.example.com/images/company-logo.png"
            alt="회사 로고"
            style={{ width: '28px', height: '28px' }}
            onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }}
          />
          <strong>스마트 번역</strong>
        </div>

        <nav style={{ padding: '12px 8px' }}>
          <ul className="nav-links">
            <li>
              <button
                className={`nav-item ${activeMenu === 'main' ? 'active' : ''}`}
                aria-current={activeMenu === 'main' ? 'page' : undefined}
                onClick={() => handleMenuChange('main')}
              >
                <span>🚀</span> AI 번역 및 검수
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeMenu === 'glossary' ? 'active' : ''}`}
                aria-current={activeMenu === 'glossary' ? 'page' : undefined}
                onClick={() => handleMenuChange('glossary')}
              >
                <span>📖</span> 용어집 (Glossary)
              </button>
            </li>
            <li>
              <button
                className={`nav-item ${activeMenu === 'settings' ? 'active' : ''}`}
                aria-current={activeMenu === 'settings' ? 'page' : undefined}
                onClick={() => openSettings()}
              >
                <span>⚙️</span> 환경 설정
              </button>
              {activeMenu === 'settings' && (
                <ul className="nav-sub-links" aria-label="환경 설정 하위 메뉴">
                  {SETTINGS_TABS.map((t) => (
                    <li key={t.id}>
                      <button
                        className={`nav-sub-item${settingsTab === t.id ? ' active' : ''}`}
                        aria-current={settingsTab === t.id ? 'page' : undefined}
                        onClick={() => openSettings(t.id)}
                        title={t.desc}
                      >
                        <span>{t.icon}</span> {t.label}
                        {settingsDirty[t.id] && (
                          <span className="nav-sub-dirty" title="저장하지 않은 변경이 있습니다" aria-label="저장하지 않은 변경 있음">
                            ●
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>

            {/* 로컬 전용 테스트 모드 섹션 (메인 메뉴와 구분선 분리) */}
            <li style={{ margin: '14px 6px 6px', borderTop: '1px solid var(--cw-line)', paddingTop: '12px' }}>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--cw-muted)', padding: '0 8px', letterSpacing: '0.5px' }}>
                LOCAL TESTING
              </span>
            </li>
            <li>
              <button
                className={`nav-item ${activeMenu === 'test' ? 'active' : ''}`}
                aria-current={activeMenu === 'test' ? 'page' : undefined}
                onClick={() => handleMenuChange('test')}
              >
                <span>🧪</span> 테스트 모드 (직접 URL)
              </button>
            </li>
          </ul>
        </nav>
      </aside>

      {/* 메인 영역 */}
      <main className="main-content">
        <header className="topbar">
          <div>
            <strong style={{ fontSize: '1.05rem' }}>
              {activeMenu === 'main' && 'AI 번역 및 품질 검수'}
              {activeMenu === 'test' && '🧪 테스트 모드 (구글 시트 URL 직접 입력)'}
              {activeMenu === 'glossary' && 'I2 공식 용어집 (Glossary)'}
              {activeMenu === 'settings' && `환경 설정 · ${SETTINGS_TABS.find((t) => t.id === settingsTab)?.label ?? ''}`}
            </strong>
            <span style={{ marginLeft: '12px', fontSize: '0.85rem', color: 'var(--cw-muted)' }}>
              Dungeon Slasher <b>/</b> Localization
            </span>
          </div>

          <div className="topbar-actions">
            {activeMenu === 'test' ? (
              <span className="cw-state-pill" data-tone="warning">
                <i></i> 직접 URL 테스트
              </span>
            ) : (
              <span className="cw-state-pill" data-tone="success">
                <i></i> 로컬 연결됨
              </span>
            )}
            <a
              href="https://company.example.com/"
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.88rem', color: 'var(--cw-muted)', textDecoration: 'none' }}
            >
              회사 홈 ↗
            </a>
          </div>
        </header>

        <div className="workspace">
          <div style={{ display: activeMenu === 'main' ? 'block' : 'none' }}>
            <SmartTranslatorView
              key="main"
              onNavigateToSettings={openSettings}
              isTestMode={false}
              refreshKey={refreshKey}
              isActive={activeMenu === 'main'}
            />
          </div>

          <div style={{ display: activeMenu === 'test' ? 'block' : 'none' }}>
            <SmartTranslatorView
              key="test"
              onNavigateToSettings={openSettings}
              isTestMode={true}
              refreshKey={refreshKey}
              isActive={activeMenu === 'test'}
            />
          </div>

          <div style={{ display: activeMenu === 'glossary' ? 'block' : 'none' }}>
            <GlossaryView refreshKey={refreshKey} />
          </div>

          <div style={{ display: activeMenu === 'settings' ? 'block' : 'none' }}>
            <SettingsView onConfigSaved={triggerRefresh} tab={settingsTab} onDirtyChange={setSettingsDirty} />
          </div>
        </div>
      </main>
    </div>
  );
}
