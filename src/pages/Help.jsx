import { COLORS } from '../lib/config';
import { KeyRound, Users2, Palette, RotateCw, ClipboardList, ListChecks, ExternalLink } from 'lucide-react';

const LEGEND_ITEMS = [
  { key: 'confirmed', tc: '已確認 — 正常排更並經點名確認', en: 'Confirmed normal shift, confirmed via roll-call' },
  { key: 'sick', tc: '病假 — 該員工當日請病假', en: 'Staff on sick leave that day' },
  { key: 'substitute', tc: '替更 — 替補其他員工的更份 (SL roster)', en: 'Substituting another staff member\'s shift (SL roster)' },
  { key: 'shs', tc: 'SHS — 特別支援更 (有薪)，人手新增', en: 'Special Home/Holiday Support shift (paid), manually added' },
  { key: 'opd', tc: '門診 OPD — 門診更份', en: 'Outpatient department duty' },
  { key: 'unconfirmed', tc: '未確認 — IPD 更份尚未經點名確認', en: 'IPD shift not yet confirmed via roll-call' },
];

function Section({ icon: Icon, title, children, testid }) {
  return (
    <div className="card p-4" data-testid={testid}>
      <h2 className="text-sm font-bold text-navy flex items-center gap-2 mb-2"><Icon size={16} /> {title}</h2>
      <div className="text-sm text-text space-y-2">{children}</div>
    </div>
  );
}

export default function Help() {
  return (
    <div className="space-y-4" data-testid="page-help">
      <div>
        <h1 className="text-xl font-bold text-navy">說明 Help</h1>
        <p className="text-sm text-muted">系統使用指南 System usage guide</p>
      </div>

      <Section icon={KeyRound} title="登入方式 How Login Works" testid="help-login">
        <p>系統使用簡單的 Token 登入（第一階段）。管理員及員工各持有專屬 Token，登入後系統依 Token 判斷身分及權限。Token 只儲存於瀏覽器記憶體（React state），不使用 localStorage / cookies，重新整理頁面後需要重新登入。</p>
        <p>The system uses simple token-based login (Phase 1). Admin and staff each hold their own token; the app determines role and permissions from the token used to sign in. Tokens live only in in-memory React state — no localStorage/cookies are used, so refreshing the page requires signing in again.</p>
      </Section>

      <Section icon={Users2} title="角色與權限 Roles &amp; Permissions" testid="help-roles">
        <p><strong>管理員 Admin：</strong>可使用所有功能，包括生成日曆/排更、編輯員工資料、公眾假期管理、強制覆核失敗的更份或換更。</p>
        <p><strong>Admin:</strong> full access — generate calendars/rosters, edit staff master data, manage holidays, and force-override failing shifts or swaps.</p>
        <p><strong>員工 Staff：</strong>可查看所有資料；只可於週六/週日申請換更；可編輯 PH/SH/RD/SHS 相關資料；每日需完成點名及工作量記錄。</p>
        <p><strong>Staff:</strong> can view everything; may only request swaps on Sat/Sun; may edit PH/SH/RD/SHS related entries; performs the daily roll-call and workload entry.</p>
      </Section>

      <Section icon={Palette} title="顏色圖例 Colour Legend" testid="help-legend">
        <ul className="space-y-2">
          {LEGEND_ITEMS.map(item => (
            <li key={item.key} className="flex items-start gap-2" data-testid={`help-legend-${item.key}`}>
              <span className="w-5 h-5 rounded border border-border shrink-0 mt-0.5" style={{ background: COLORS[item.key].bg }} />
              <span>
                <span className="block text-text">{item.tc}</span>
                <span className="block text-muted text-xs">{item.en}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-2">SHS 及 OPD 一經生成即帶有顏色，不受點名確認狀態影響。SHS and OPD keep their colour regardless of roll-call confirmation status.</p>
      </Section>

      <Section icon={RotateCw} title="輪次模型 The Round Model" testid="help-round-model">
        <p>每位員工在每個名單（PH／病假 SK／颱風 TY／惡劣天氣 EW）均有「在職 Active」、「輪次 Round」及「次序 Order」屬性。名單依 Round 升序、再依 Order 升序排列；「Next-10」是本輪尚未輪值、排序最前的十位員工。</p>
        <p>Each staff member has Active/Round/Order attributes per list (PH, Sick, Typhoon, Extreme Wx). Lists sort by Round ascending then Order ascending; "Next-10" are the first ten not-yet-assigned staff in the current round.</p>
        <p>公眾假期生成：合資格者為 Tier 1/2 且在職，依次序指派；若該員工當日檢查失敗（FAIL）則跳到下一位，翌日從被跳過的位置繼續；同一員工在本輪完成前不會被重複選中。若整輪都無法滿足規則，該日會標示「NEEDS ADMIN」。</p>
        <p>PH generation: eligible staff are Tier 1/2 and Active; assignment proceeds down the order, skipping anyone who fails validation for that day (continuing from the skipped position the next day); a staff member is not re-picked until the round completes. If no staff can satisfy the rules, the day is marked NEEDS ADMIN.</p>
        <p>補更（Make-up）：記錄「補返」日期後，該員工在該名單的輪次 Round 會 +1，移至名單後方。</p>
        <p>Recording a "back duty" increments that staff's Round for that list, moving them later in the list.</p>
      </Section>

      <Section icon={ClipboardList} title="點名及工作量流程 Roll-call &amp; Workload Flow" testid="help-rollcall-flow">
        <p>每日排更會預先載入當日的 IPD 名單。管理者或員工於「點名」頁面確認每位員工出席或病假；病假者可從病假 Next-10 建議名單或全部在職員工中選擇替更人員。儲存後，灰色（未確認）的名單會轉為對應顏色（綠色確認／粉紅病假／藍色替更）。</p>
        <p>Each day's roster preloads that day's IPD list. On the Roll-call page, confirm each staff member as present or sick; for sick staff, choose a substitute from the Sick Next-10 suggestions or the full active staff list. Saving turns grey (unconfirmed) entries into their confirmed colour (green/pink/blue).</p>
        <p>工作量（Workload）為部門每日整體記錄，包含 ICU/HDU、骨科 Ortho、神經 Neuro、內外科 M&amp;S 及新症 New；總數 Total = ICU/HDU + Ortho + Neuro + M&amp;S，新症另計。</p>
        <p>Workload is a once-daily department-wide entry covering ICU/HDU, Ortho, Neuro, M&amp;S and New cases; Total = ICU/HDU + Ortho + Neuro + M&amp;S, with New counted separately.</p>
      </Section>

      <Section icon={ListChecks} title="排更規則 Rule Set" testid="help-rules">
        <ul className="list-disc list-inside space-y-1">
          <li>週六 Saturday：6 位 IPD + 1 位 OPD。</li>
          <li>週日／公眾假期／休息日／颱風日 Sun/PH/RD/SH：5 位 IPD（不設 OPD）。</li>
          <li>每個更份需 ≥2 位 Tier 1（資深）；≥1 位 ORT；≥1 位 NEURO。</li>
          <li>Tier 3（新人）上更時，其指定 Mentor 必須同時在該更份。</li>
          <li>累積假期 CL：RD → 30 天；SH → 60 天；PH → 約 183 天。</li>
        </ul>
        <ul className="list-disc list-inside space-y-1 text-muted text-xs mt-2">
          <li>Saturday: 6 IPD + 1 OPD.</li>
          <li>Sunday/Public Holiday/Rest Day/Storm Holiday: 5 IPD (no OPD).</li>
          <li>Every shift needs ≥2 Tier-1 staff, ≥1 ORT-qualified, ≥1 NEURO-qualified.</li>
          <li>A Tier-3 (new recruit) staff member requires their named Mentor on the same shift.</li>
          <li>Compensation leave: RD → 30 days, SH → 60 days, PH → ~183 days.</li>
        </ul>
      </Section>

      <div className="card p-4 flex items-start gap-2 text-sm text-muted" data-testid="help-deploy-note">
        <ExternalLink size={16} className="shrink-0 mt-0.5" />
        <span>部署備註：本應用為前端 (React + Vite) 連接 Google Apps Script 後端及 Google Sheet 資料庫，設定於 <code className="text-xs bg-bg px-1 rounded">src/lib/config.js</code>（API_URL / SHEET_ID）。Deployment note: this frontend (React + Vite) connects to a Google Apps Script backend and Google Sheet database, configured in <code className="text-xs bg-bg px-1 rounded">src/lib/config.js</code> (API_URL / SHEET_ID).</span>
      </div>
    </div>
  );
}
