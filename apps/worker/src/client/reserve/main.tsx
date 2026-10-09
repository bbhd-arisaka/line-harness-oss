// main.tsx — カレンダー予約(友だち側)のReact。LIFFの本体(client/main.ts)から、動的importで読み込まれる。
// 友だち予約URL = ?page=reserve&calendar=ID(&link=ID)、予約履歴 = &view=history、予約の確認 = &view=detail&id=予約ID

import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  ReserveApiError,
  addDays,
  addMonths,
  formatDateTime,
  formatPrice,
  googleCalendarUrl,
  reserveClient,
  todayJst,
  weekdayJa,
} from './lib.js';
import type { Option, PublicBooking, ReserveConfig, ReserveContext } from './lib.js';
import './styles.css';

let _root: Root | null = null;

const GREEN = '#06C755';
const card = 'rounded-xl bg-white p-4 shadow-sm border border-gray-200';
const primaryBtn = 'w-full rounded-lg py-3 text-center text-[15px] font-bold text-white disabled:opacity-50';
const ghostBtn = 'w-full rounded-lg border border-gray-300 bg-white py-3 text-center text-[15px] text-gray-700';

type Route = { name: 'book'; changing?: PublicBooking; preset?: { slotId: string | null; courseId: string | null; answers?: Record<string, string> } } | { name: 'history' } | { name: 'detail'; id: string };

function errText(e: unknown): string {
  return e instanceof Error ? e.message : '通信に失敗しました';
}

function Html({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function Description({ opt }: { opt: Option }) {
  if (!opt.description) return null;
  return opt.descriptionHtml ? <Html html={opt.description} className="mt-1 text-xs text-gray-600" /> : <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{opt.description}</p>;
}

function App({ ctx }: { ctx: ReserveContext }) {
  const initial: Route = ctx.view === 'history' ? { name: 'history' } : ctx.view === 'detail' && ctx.bookingId ? { name: 'detail', id: ctx.bookingId } : { name: 'book' };
  const [route, setRoute] = useState<Route>(initial);
  const [config, setConfig] = useState<ReserveConfig | null>(null);
  const [error, setError] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);

  useEffect(() => {
    reserveClient.config(ctx).then(setConfig).catch((e) => setError(errText(e)));
  }, [ctx]);

  const title = config?.screen?.adminInfo?.name || '予約ページ';
  const go = useCallback((r: Route) => {
    window.scrollTo(0, 0);
    setRoute(r);
  }, []);

  return (
    <div className="rs-fade-in min-h-screen" style={{ background: '#f5f5f5' }}>
      <header className="flex items-center justify-between px-4 py-3 text-white" style={{ background: GREEN }}>
        <div className="flex items-center gap-2 text-[15px] font-bold">
          {config?.screen?.adminInfo?.imageUrl ? <img src={config.screen.adminInfo.imageUrl} alt="" className="h-6 w-6 rounded-full object-cover" /> : null}
          <span>{title}</span>
          {config?.screen?.adminInfo ? (
            <button type="button" aria-label="管理者情報" onClick={() => setShowAdmin(true)} className="ml-1 flex h-5 w-5 items-center justify-center rounded-full border border-white text-[11px]">i</button>
          ) : null}
        </div>
        {route.name === 'history' ? (
          <button type="button" className="text-xs underline" onClick={() => go({ name: 'book' })}>予約する</button>
        ) : (
          <button type="button" className="text-xs underline" onClick={() => go({ name: 'history' })}>予約履歴</button>
        )}
      </header>
      <main className="mx-auto max-w-md px-4 py-4 pb-24">
        {error ? <p className={`${card} text-sm text-red-600`}>{error}</p> : null}
        {!config && !error ? <p className="py-10 text-center text-sm text-gray-500">読み込み中…</p> : null}
        {config?.stopped ? <p className={`${card} text-center text-sm text-gray-700`}>現在、予約受付を停止しています。</p> : null}
        {config && !config.stopped ? (
          route.name === 'book' ? (
            <Booking key={JSON.stringify(route)} ctx={ctx} config={config} route={route} go={go} />
          ) : route.name === 'history' ? (
            <History ctx={ctx} config={config} go={go} />
          ) : (
            <Detail ctx={ctx} config={config} id={route.id} go={go} />
          )
        ) : null}
      </main>

      {showAdmin && config?.screen?.adminInfo ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={() => setShowAdmin(false)}>
          <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            {config.screen.adminInfo.imageUrl ? <img src={config.screen.adminInfo.imageUrl} alt="" className="mb-3 max-h-48 w-full rounded-lg object-cover" /> : null}
            {config.screen.adminInfo.name ? <h2 className="mb-2 text-lg font-bold">{config.screen.adminInfo.name}</h2> : null}
            {config.screen.adminInfo.address ? <p className="mb-1 text-sm">所在地: {config.screen.adminInfo.address}</p> : null}
            {config.screen.adminInfo.phone ? <p className="mb-1 text-sm">電話番号: {config.screen.adminInfo.phone}</p> : null}
            {config.screen.adminInfo.description ? <p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{config.screen.adminInfo.description}</p> : null}
            <button type="button" className={`${ghostBtn} mt-4`} onClick={() => setShowAdmin(false)}>閉じる</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ── 予約・変更の流れ ────────────────────────────────────────────────────────

type Step = 'pick' | 'form' | 'confirm' | 'done';

function Booking({ ctx, config, route, go }: { ctx: ReserveContext; config: ReserveConfig; route: Extract<Route, { name: 'book' }>; go: (r: Route) => void }) {
  const screen = config.screen!;
  const slots = config.slots ?? [];
  const courses = config.courses ?? [];
  const links = config.links ?? [];
  const changing = route.changing ?? null;
  const [slotId, setSlotId] = useState<string | null>(changing ? changing.slotId : (route.preset?.slotId ?? config.preset?.slotId ?? null));
  const [courseId, setCourseId] = useState<string | null>(changing ? changing.courseId : (route.preset?.courseId ?? config.preset?.courseId ?? null));
  const [sheet, setSheet] = useState<'slot' | 'course' | null>(null);
  const [mode, setMode] = useState<'week' | 'month'>(screen.view);
  const [anchor, setAnchor] = useState(todayJst());
  const [days, setDays] = useState<Record<string, Array<{ time: string; available: boolean }>>>({});
  const [loading, setLoading] = useState(false);
  const [noOptions, setNoOptions] = useState(false);
  const [step, setStep] = useState<Step>('pick');
  const [startsAt, setStartsAt] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>(changing?.answerValues ?? route.preset?.answers ?? config.prefill ?? {});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ booking: PublicBooking; thanksUrl: string | null } | null>(null);

  const slotReq = config.slotSettings?.required && slots.length > 0;
  const courseReq = config.courseSettings?.required && courses.length > 0;
  const ready = !(slotReq && !slotId) && !(courseReq && !courseId);
  const slot = slots.find((s) => s.id === slotId) ?? null;
  const course = courses.find((c) => c.id === courseId) ?? null;

  // 選んだ予約枠で受けられるコース(紐づけ)
  const courseOptions = useMemo(() => (slotId ? courses.filter((c) => links.some((l) => l.slotId === slotId && l.courseId === c.id)) : courses.filter((c) => links.some((l) => l.courseId === c.id) || links.length === 0)), [slotId, courses, links]);
  const slotOptions = useMemo(() => (courseId ? slots.filter((s) => links.some((l) => l.slotId === s.id && l.courseId === courseId)) : slots), [courseId, slots, links]);

  const range = useMemo(() => {
    if (mode === 'week') return { from: anchor, to: addDays(anchor, 6) };
    const first = `${anchor.slice(0, 7)}-01`;
    return { from: first, to: addDays(addMonths(first, 1), -1) };
  }, [mode, anchor]);

  useEffect(() => {
    if (!ready || step !== 'pick') return;
    let cancelled = false;
    setLoading(true);
    setError('');
    reserveClient
      .availability(ctx, slotId, courseId, range.from < todayJst() ? todayJst() : range.from, range.to)
      .then((r) => {
        if (cancelled) return;
        setDays(r.days);
        setNoOptions(r.noOptions);
      })
      .catch((e) => !cancelled && setError(errText(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [ctx, ready, slotId, courseId, range.from, range.to, step]);

  const times = useMemo(() => {
    const set = new Set<string>();
    for (const list of Object.values(days)) for (const t of list) set.add(t.time);
    return [...set].sort();
  }, [days]);

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(anchor, i));
  const canPrev = mode === 'week' ? anchor > todayJst() : range.from > `${todayJst().slice(0, 7)}-01`;

  const price = (course && config.courseSettings?.priceEnabled ? course.price : 0) + (slot && config.slotSettings?.priceEnabled ? slot.price : 0);
  const reqMode = changing ? changing.changeMode === 'request' : config.approval?.newBooking === 'request';

  const validateForm = (): string => {
    for (const f of screen.fields) {
      const v = (answers[f.id] ?? '').trim();
      if (f.required && !v) return `「${f.label}」を入力してください`;
      if (v && f.type === 'text') {
        if (f.textKind === 'kana' && !/^[゠-ヿ　\s・ー]+$/.test(v)) return `「${f.label}」は、カタカナで入力してください`;
        if (f.textKind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `「${f.label}」は、メールアドレスの形式で入力してください`;
        if (f.textKind === 'phone' && !/^\d{9,11}$/.test(v)) return `「${f.label}」は、半角数字で入力してください`;
        if (f.textKind === 'integer' && !/^-?\d+$/.test(v)) return `「${f.label}」は、半角の整数で入力してください`;
      }
    }
    if (screen.consent && !consent && !changing) return `${screen.consent.title}に同意してください`;
    return '';
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const body = { slotId, courseId, startsAt, answers };
      const r = changing ? await reserveClient.change(ctx, changing.id, body) : await reserveClient.book(ctx, { ...body, consent: consent || !screen.consent });
      setResult(r);
      setStep('done');
      if (r.thanksUrl) window.location.href = r.thanksUrl;
    } catch (e) {
      setError(errText(e));
      if (e instanceof ReserveApiError && e.code === 'unavailable') setStep('pick');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'done' && result) {
    const b = result.booking;
    return (
      <div className="space-y-4">
        <div className={`${card} text-center`}>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full text-2xl text-white" style={{ background: GREEN }}>✓</div>
          <h2 className="mb-1 text-lg font-bold">{b.status === 'pending' || b.pendingKind ? 'リクエストを受け付けました' : changing ? '予約を変更しました' : '予約が完了しました'}</h2>
          {b.status === 'pending' || b.pendingKind ? <p className="text-xs text-gray-600">管理者が承認すると、予約が確定します。</p> : null}
        </div>
        <Summary b={b} config={config} />
        {!(b.status === 'pending' || b.pendingKind) ? (
          <a className={`${ghostBtn} block`} target="_blank" rel="noreferrer" href={googleCalendarUrl(`${config.screen?.adminInfo?.name || config.name}の予約`, b.startsAt, b.endsAt, `${b.slotName} / ${b.courseName}`)}>Googleカレンダーに予定を追加する</a>
        ) : null}
        <button type="button" className={ghostBtn} onClick={() => go({ name: 'history' })}>予約履歴を見る</button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {changing ? <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{formatDateTime(changing.startsAt)} の予約を変更します。{changing.changeMode === 'request' ? '変更は、管理者の承認後に確定します。' : ''}</p> : null}

      {step === 'pick' ? (
        <>
          {slots.length > 0 ? (
            <SelectRow label={config.slotSettings!.title} required={!!slotReq} value={slot?.name ?? '指定なし'} onOpen={() => setSheet('slot')} />
          ) : null}
          {courses.length > 0 ? (
            <SelectRow label={config.courseSettings!.title} required={!!courseReq} value={course ? `${course.name}${config.courseSettings!.showDuration && course.minutes ? `(${course.minutes}分)` : ''}` : '指定なし'} onOpen={() => setSheet('course')} />
          ) : null}

          {!ready ? (
            <p className={`${card} text-center text-sm text-gray-600`}>{slotReq && !slotId ? `${config.slotSettings!.title}を選択してください` : `${config.courseSettings!.title}を選択してください`}</p>
          ) : (
            <div className={card}>
              <div className="mb-2 flex items-center justify-between">
                <button type="button" disabled={!canPrev} className="px-3 py-1 text-lg disabled:opacity-30" onClick={() => setAnchor(mode === 'week' ? (addDays(anchor, -7) < todayJst() ? todayJst() : addDays(anchor, -7)) : addMonths(anchor, -1))} aria-label="前へ">‹</button>
                <div className="text-sm font-bold">{mode === 'week' ? `${anchor.slice(5, 7)}月${anchor.slice(8)}日 〜` : `${anchor.slice(0, 4)}年${Number(anchor.slice(5, 7))}月`}</div>
                <button type="button" className="px-3 py-1 text-lg" onClick={() => setAnchor(mode === 'week' ? addDays(anchor, 7) : addMonths(anchor, 1))} aria-label="次へ">›</button>
              </div>
              <div className="mb-3 flex justify-center gap-2 text-xs">
                <button type="button" className={`rounded-full px-3 py-1 ${mode === 'week' ? 'text-white' : 'bg-gray-100 text-gray-600'}`} style={mode === 'week' ? { background: GREEN } : undefined} onClick={() => { setMode('week'); if (anchor < todayJst()) setAnchor(todayJst()); }}>週間</button>
                <button type="button" className={`rounded-full px-3 py-1 ${mode === 'month' ? 'text-white' : 'bg-gray-100 text-gray-600'}`} style={mode === 'month' ? { background: GREEN } : undefined} onClick={() => setMode('month')}>月間</button>
              </div>
              {loading ? <p className="py-6 text-center text-sm text-gray-500">読み込み中…</p> : null}
              {!loading && noOptions ? <p className="py-6 text-center text-sm text-gray-600">予約可能な日程がありません</p> : null}
              {!loading && !noOptions && mode === 'week' ? (
                times.length === 0 ? (
                  <p className="py-6 text-center text-sm text-gray-600">この週に、予約できる日程がありません</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] border-collapse text-center text-sm">
                      <thead>
                        <tr>
                          <th className="w-14" />
                          {weekDates.map((d) => (
                            <th key={d} className={`px-1 py-1 text-xs font-medium ${weekdayJa(d) === '日' ? 'text-red-600' : weekdayJa(d) === '土' ? 'text-blue-600' : ''}`}>{Number(d.slice(5, 7))}/{Number(d.slice(8))}<br />({weekdayJa(d)})</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {times.map((t) => (
                          <tr key={t} className="border-t border-gray-100">
                            <td className="py-1 text-xs text-gray-600">{t}</td>
                            {weekDates.map((d) => {
                              const cell = days[d]?.find((x) => x.time === t);
                              return (
                                <td key={d} className="py-1">
                                  {cell ? (
                                    cell.available ? (
                                      <button type="button" className="h-9 w-9 rounded-full text-base font-bold" style={{ color: GREEN }} onClick={() => { setStartsAt(`${d}T${t}`); setStep('form'); setError(''); }} aria-label={`${d} ${t} 予約する`}>◯</button>
                                    ) : (
                                      <span className="text-gray-400">×</span>
                                    )
                                  ) : (
                                    <span className="text-gray-300">-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              ) : null}
              {!loading && !noOptions && mode === 'month' ? (
                <MonthGrid anchor={anchor} days={days} onPick={(d) => { setAnchor(d); setMode('week'); }} />
              ) : null}
            </div>
          )}
        </>
      ) : null}

      {step === 'form' ? (
        <div className={`${card} space-y-4`}>
          <p className="text-sm font-bold" style={{ color: GREEN }}>{formatDateTime(startsAt)}</p>
          {screen.fields.map((f) => (
            <label key={f.id} className="block text-sm">
              <span className="mb-1 block font-medium">{f.label}{f.required ? <span className="ml-1 text-xs text-red-600">必須</span> : null}</span>
              {f.description ? <span className="mb-1 block text-xs text-gray-500">{f.description}</span> : null}
              {f.type === 'textarea' ? (
                <textarea className="w-full rounded-lg border border-gray-300 p-2" rows={4} value={answers[f.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} />
              ) : f.type === 'select' ? (
                <select className="w-full rounded-lg border border-gray-300 p-2" value={answers[f.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })}>
                  <option value="">選択してください</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="w-full rounded-lg border border-gray-300 p-2" inputMode={f.textKind === 'phone' || f.textKind === 'integer' ? 'numeric' : f.textKind === 'email' ? 'email' : 'text'} value={answers[f.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [f.id]: e.target.value })} />
              )}
            </label>
          ))}
          {screen.consent && !changing ? (
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="mb-1 text-sm font-bold">{screen.consent.title}</p>
              <p className="mb-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-gray-600">{screen.consent.body}</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> {screen.consent.title}に同意する</label>
            </div>
          ) : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="button" className={primaryBtn} style={{ background: GREEN }} onClick={() => { const m = validateForm(); if (m) setError(m); else { setError(''); setStep('confirm'); } }}>入力内容を確認する</button>
          <button type="button" className={ghostBtn} onClick={() => setStep('pick')}>日時を選び直す</button>
        </div>
      ) : null}

      {step === 'confirm' ? (
        <div className="space-y-4">
          <Summary
            config={config}
            b={{ id: '', startsAt, endsAt: startsAt, status: 'confirmed', pendingKind: null, slotId, courseId, slotName: slot?.name ?? '指定なし', courseName: course?.name ?? '指定なし', price, answers: screen.fields.filter((f) => answers[f.id]).map((f) => ({ label: f.label, value: answers[f.id] })), answerValues: answers, canChange: false, canCancel: false, changeMode: 'direct', cancelMode: 'direct' }}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button type="button" className={primaryBtn} style={{ background: GREEN }} disabled={busy} onClick={() => void submit()}>{busy ? '送信中…' : reqMode ? 'リクエストを送信する' : changing ? '変更内容を確定する' : '予約内容を確定する'}</button>
          <button type="button" className={ghostBtn} onClick={() => setStep('form')}>戻る</button>
        </div>
      ) : null}

      {sheet ? (
        <OptionSheet
          title={sheet === 'slot' ? config.slotSettings!.title : config.courseSettings!.title}
          options={sheet === 'slot' ? slotOptions : courseOptions}
          selectedId={sheet === 'slot' ? slotId : courseId}
          optional={sheet === 'slot' ? !slotReq : !courseReq}
          showMinutes={sheet === 'course' && !!config.courseSettings?.showDuration}
          showPrice={sheet === 'slot' ? !!config.slotSettings?.priceEnabled : !!config.courseSettings?.priceEnabled}
          onClose={() => setSheet(null)}
          onPick={(id) => {
            if (sheet === 'slot') {
              setSlotId(id);
              // 組み合わせが成り立たないコースは、外す
              if (id && courseId && !links.some((l) => l.slotId === id && l.courseId === courseId)) setCourseId(null);
            } else {
              setCourseId(id);
              if (id && slotId && !links.some((l) => l.slotId === slotId && l.courseId === id)) setSlotId(null);
            }
            setSheet(null);
          }}
        />
      ) : null}
      {error && step === 'pick' ? <p className={`${card} text-sm text-red-600`}>{error}</p> : null}
    </div>
  );
}

function SelectRow({ label, required, value, onOpen }: { label: string; required: boolean; value: string; onOpen: () => void }) {
  return (
    <div className={`${card} flex items-center justify-between gap-3`}>
      <div className="min-w-0">
        <div className="text-xs text-gray-500">{label}{required ? <span className="ml-1 text-red-600">必須</span> : null}</div>
        <div className="truncate text-[15px] font-medium">{value}</div>
      </div>
      <button type="button" className="shrink-0 rounded-lg border px-4 py-2 text-sm font-bold" style={{ borderColor: GREEN, color: GREEN }} onClick={onOpen}>選択する</button>
    </div>
  );
}

function OptionSheet({ title, options, selectedId, optional, showMinutes, showPrice, onClose, onPick }: { title: string; options: Option[]; selectedId: string | null; optional: boolean; showMinutes: boolean; showPrice: boolean; onClose: () => void; onPick: (id: string | null) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 sm:items-center sm:justify-center" onClick={onClose}>
      <div className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:max-w-md sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-base font-bold">{title}を選択</h2>
        <ul className="space-y-2">
          {optional ? (
            <li><button type="button" className={`w-full rounded-lg border p-3 text-left ${selectedId === null ? 'border-2' : ''}`} style={selectedId === null ? { borderColor: GREEN } : undefined} onClick={() => onPick(null)}>指定なし</button></li>
          ) : null}
          {options.length === 0 ? <li className="py-4 text-center text-sm text-gray-500">選べるものがありません</li> : null}
          {options.map((o) => (
            <li key={o.id}>
              <button type="button" className={`w-full rounded-lg border p-3 text-left ${selectedId === o.id ? 'border-2' : ''}`} style={selectedId === o.id ? { borderColor: GREEN } : undefined} onClick={() => onPick(o.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 font-medium">{o.iconUrl ? <img src={o.iconUrl} alt="" className="h-8 w-8 rounded-full object-cover" /> : null}{o.name}</span>
                  <span className="text-xs text-gray-600">{showMinutes && o.minutes ? `${o.minutes}分` : ''}{showMinutes && o.minutes && showPrice ? ' / ' : ''}{showPrice ? formatPrice(o.price) : ''}</span>
                </div>
                <Description opt={o} />
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className={`${ghostBtn} mt-4`} onClick={onClose}>閉じる</button>
      </div>
    </div>
  );
}

function MonthGrid({ anchor, days, onPick }: { anchor: string; days: Record<string, Array<{ time: string; available: boolean }>>; onPick: (d: string) => void }) {
  const first = `${anchor.slice(0, 7)}-01`;
  const lead = new Date(`${first}T00:00:00Z`).getUTCDay();
  const count = Number(addDays(addMonths(first, 1), -1).slice(8));
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${first.slice(0, 8)}${String(i + 1).padStart(2, '0')}`)];
  return (
    <div className="grid grid-cols-7 gap-y-1 text-center text-sm">
      {['日', '月', '火', '水', '木', '金', '土'].map((w) => <div key={w} className="py-1 text-xs text-gray-500">{w}</div>)}
      {cells.map((d, i) => {
        if (!d) return <div key={`b${i}`} />;
        const any = (days[d] ?? []).some((x) => x.available);
        return (
          <div key={d} className="py-1">
            <button type="button" disabled={!any} onClick={() => onPick(d)} className="flex h-11 w-full flex-col items-center justify-center rounded-lg disabled:opacity-40">
              <span className="text-xs">{Number(d.slice(8))}</span>
              <span className="text-sm font-bold" style={{ color: any ? GREEN : '#9ca3af' }}>{(days[d] ?? []).length === 0 ? '-' : any ? '◯' : '×'}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

function Summary({ b, config }: { b: PublicBooking; config: ReserveConfig }) {
  const rows: Array<[string, string]> = [
    ['予約日時', formatDateTime(b.startsAt) + (b.endsAt && b.endsAt !== b.startsAt ? `〜${b.endsAt.slice(11, 16)}` : '')],
    [config.slotSettings?.title ?? '予約枠', b.slotName],
    [config.courseSettings?.title ?? 'コース', b.courseName],
    ...(config.slotSettings?.priceEnabled || config.courseSettings?.priceEnabled ? ([['料金', formatPrice(b.price)]] as Array<[string, string]>) : []),
    ...b.answers.map((a) => [a.label, a.value] as [string, string]),
  ];
  return (
    <dl className={`${card} space-y-2 text-sm`}>
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[96px_1fr] gap-2"><dt className="text-gray-500">{k}</dt><dd className="whitespace-pre-wrap break-words">{v}</dd></div>
      ))}
    </dl>
  );
}

// ── 予約履歴・確認 ──────────────────────────────────────────────────────────

const STATUS: Record<string, { text: string; cls: string }> = {
  confirmed: { text: '予約済み', cls: 'bg-green-100 text-green-800' },
  pending: { text: '承認待ち', cls: 'bg-amber-100 text-amber-800' },
  cancelled: { text: 'キャンセル済み', cls: 'bg-gray-200 text-gray-700' },
  rejected: { text: '承認されませんでした', cls: 'bg-gray-200 text-gray-700' },
};

function BookingActions({ ctx, config, b, go, onChanged }: { ctx: ReserveContext; config: ReserveConfig; b: PublicBooking; go: (r: Route) => void; onChanged: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const doCancel = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await reserveClient.cancel(ctx, b.id);
      setConfirm(false);
      onChanged();
      if (r.thanksUrl) window.location.href = r.thanksUrl;
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-2">
      {b.pendingKind && b.status !== 'pending' ? <p className="text-xs text-amber-800">{b.pendingKind === 'change' ? '変更' : 'キャンセル'}のリクエストを受け付けています。管理者の承認をお待ちください。</p> : null}
      <div className="flex gap-2">
        {b.canChange ? <button type="button" className="flex-1 rounded-lg border py-2 text-sm font-bold" style={{ borderColor: GREEN, color: GREEN }} onClick={() => go({ name: 'book', changing: b })}>{b.changeMode === 'request' ? '変更をリクエスト' : '予約を変更'}</button> : null}
        {b.canCancel ? <button type="button" className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700" onClick={() => setConfirm(true)}>{b.cancelMode === 'request' ? 'キャンセルをリクエスト' : 'キャンセル'}</button> : null}
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
      {confirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-5" onClick={(e) => e.stopPropagation()}>
            <p className="mb-4 text-sm">{formatDateTime(b.startsAt)} の予約を、{b.cancelMode === 'request' ? 'キャンセルするリクエストを送ります' : 'キャンセルします'}。よろしいですか?</p>
            <div className="flex gap-2">
              <button type="button" className={ghostBtn} onClick={() => setConfirm(false)}>戻る</button>
              <button type="button" className={primaryBtn} style={{ background: '#e8355d' }} disabled={busy} onClick={() => void doCancel()}>{busy ? '送信中…' : 'はい'}</button>
            </div>
          </div>
        </div>
      ) : null}
      <span className="hidden">{config.name}</span>
    </div>
  );
}

function History({ ctx, config, go }: { ctx: ReserveContext; config: ReserveConfig; go: (r: Route) => void }) {
  const [data, setData] = useState<{ bookings: PublicBooking[] } | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    reserveClient.me(ctx).then(setData).catch((e) => setError(errText(e)));
  }, [ctx]);
  useEffect(load, [load]);
  if (error) return <p className={`${card} text-sm text-red-600`}>{error}</p>;
  if (!data) return <p className="py-10 text-center text-sm text-gray-500">読み込み中…</p>;
  const last = data.bookings.find((b) => b.status !== 'rejected');
  return (
    <div className="space-y-3">
      <h1 className="text-base font-bold">予約履歴</h1>
      {last ? (
        <button type="button" className={ghostBtn} onClick={() => go({ name: 'book', preset: { slotId: last.slotId, courseId: last.courseId, answers: last.answerValues } })}>前回と同じ内容で予約する</button>
      ) : null}
      {data.bookings.length === 0 ? <p className={`${card} text-center text-sm text-gray-600`}>予約履歴がありません</p> : null}
      {data.bookings.map((b) => (
        <div key={b.id} className={card}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[15px] font-bold">{formatDateTime(b.startsAt)}</span>
            <span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[b.status]?.cls}`}>{STATUS[b.status]?.text}</span>
          </div>
          <p className="mt-1 text-xs text-gray-600">{b.slotName} / {b.courseName}</p>
          <button type="button" className="mt-1 text-xs underline" style={{ color: GREEN }} onClick={() => go({ name: 'detail', id: b.id })}>詳細を見る</button>
          <BookingActions ctx={ctx} config={config} b={b} go={go} onChanged={load} />
        </div>
      ))}
    </div>
  );
}

function Detail({ ctx, config, id, go }: { ctx: ReserveContext; config: ReserveConfig; id: string; go: (r: Route) => void }) {
  const [b, setB] = useState<PublicBooking | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    reserveClient.detail(ctx, id).then(setB).catch((e) => setError(errText(e)));
  }, [ctx, id]);
  useEffect(load, [load]);
  if (error) return <p className={`${card} text-sm text-red-600`}>{error}</p>;
  if (!b) return <p className="py-10 text-center text-sm text-gray-500">読み込み中…</p>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between"><h1 className="text-base font-bold">予約内容の確認</h1><span className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS[b.status]?.cls}`}>{STATUS[b.status]?.text}</span></div>
      <Summary b={b} config={config} />
      <BookingActions ctx={ctx} config={config} b={b} go={go} onChanged={load} />
      <button type="button" className={ghostBtn} onClick={() => go({ name: 'history' })}>予約履歴へ</button>
    </div>
  );
}

export function mountReserve(container: HTMLElement, ctx: ReserveContext): void {
  document.body.classList.add('rs-active');
  if (_root) {
    _root.unmount();
    _root = null;
  }
  container.innerHTML = '';
  _root = createRoot(container);
  _root.render(
    <StrictMode>
      <App ctx={ctx} />
    </StrictMode>,
  );
}

export function unmountReserve(): void {
  if (_root) {
    _root.unmount();
    _root = null;
  }
  document.body.classList.remove('rs-active');
}
