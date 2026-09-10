#!/usr/bin/env node
// The job schedule (Step 30): one table in New York time, read by the hourly
// tick. Pins the table against the spec, the daylight-saving behavior, the
// phase order, the env override and its validation, the report, and the tick.
//   node tools/test-jobs.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); } };
const src = fs.readFileSync(path.join(ROOT, '_worker.js'), 'utf8');
const cut = (a, b) => { const i = src.indexOf(a), j = src.indexOf(b, i); if (i < 0 || j < 0) { console.error('FAIL: cut ' + a.slice(0, 40)); process.exit(1); } return src.slice(i, j); };

// Real ET clock helpers from the worker; stubbed jobs that record their runs.
const runs = [];
const JOB_FNS = Object.fromEntries(['schedule-refresh', 'odds-refresh', 'availability-refresh', 'market-snapshot', 'usage-refresh', 'usage-prior-refresh', 'dfs-refresh', 'depth-charts', 'ros-snapshot', 'calls-grade', 'rivalry-column', 'news-scan', 'snapshot-prune', 'analytics-prune', 'job-prune', 'content-tick', 'league-sync'].map(j => [j, async () => ({ ok: true })]));
const jobRun = async (env, name, trigger) => {
  const rec = { job: name, trigger, started: Date.now() }; runs.push(rec);
  if (name === 'schedule-refresh') await new Promise(r => setTimeout(r, 30));
  if (name === 'odds-refresh' && env.failOdds) return { ok: false, error: 'the books did not answer' };
  rec.finished = Date.now();
  return { ok: true };
};
const H = new Function('JOB_FNS', 'jobRun', 'LEAD_TZ',
  cut('function etOffsetHours(ms) {', 'function etClock(ms) {') + '\n' + cut('function etParts(ms) {', 'const _etDow = ') + '\n' +
  cut('// -- the job schedule (Step 30)', '// Memoized per isolate alongside _PROJ_ENC') +
  '\nreturn { JOB_SCHEDULE, jobEntryCheck, jobScheduleFrom, jobsDueAt, jobScheduleReport, runScheduledTick, etParts };'
)(JOB_FNS, jobRun, 'America/New_York');
// An instant from an Eastern wall-clock time (EDT in September, EST in December).
const ET = (y, m, d, h, min, edt) => Date.UTC(y, m - 1, d, h + (edt ? 4 : 5), min || 0);
const due = now => H.jobsDueAt(H.jobScheduleFrom({}).entries, now).map(x => x.job);

console.log('\nthe table against the spec');
{
  const S = H.JOB_SCHEDULE;
  const of = j => S.filter(e => e.job === j);
  ok('every entry names a job the log can run', S.every(e => JOB_FNS[e.job]));
  ok('every entry validates', S.every(e => typeof H.jobEntryCheck(e) !== 'string'));
  ok('the ROS, Next 3 and Weeks 15-17 recalculation is Tuesday 6 AM, phase 2, before the 7 AM rankings piece', of('ros-snapshot').length === 1 && of('ros-snapshot')[0].days.join() === 'Tue' && of('ros-snapshot')[0].hours.join() === '6' && of('ros-snapshot')[0].phase === 2);
  ok('the desk tick is quarter-hourly and last', of('content-tick')[0].hours === 'hourly' && of('content-tick')[0].minutes.join() === '0,15,30,45' && of('content-tick')[0].phase === 3);
  ok('the news scan is quarter-hourly, phase 2', of('news-scan').length === 1 && of('news-scan')[0].minutes.length === 4 && of('news-scan')[0].phase === 2);
  ok('Sunday inactives are pulled every quarter hour from 10 AM', of('availability-refresh').some(e => e.days && e.days.join() === 'Sun' && e.minutes && e.minutes.length === 4 && e.hours.includes(11)));
  ok('the calls grader runs after the usage file lands', of('calls-grade').length === 1 && of('calls-grade')[0].days.join() === 'Tue,Wed' && of('calls-grade')[0].hours.join() === '6');
  ok('the rivalry column is built Thursday morning, hours before the first kickoff, and retried after', of('rivalry-column').length === 1 && of('rivalry-column')[0].days.join() === 'Thu,Fri,Sat' && of('rivalry-column')[0].hours.join() === '8' && of('rivalry-column')[0].phase === 2);
  ok('the schedule refresh is hourly and first', of('schedule-refresh')[0].hours === 'hourly' && of('schedule-refresh')[0].phase === 1);
  ok('betting lines are sampled every three hours and hourly on Sunday', of('market-snapshot').some(e => !e.days && e.hours.length === 8) && of('market-snapshot').some(e => e.days && e.days.join() === 'Sun' && e.hours.length === 15));
  ok('the injury list refreshes more than once a day', of('availability-refresh')[0].hours.length >= 3);
  ok('rankings, injury and betting updates are independent rows, not tied to a piece', ['ros-snapshot', 'availability-refresh', 'market-snapshot'].every(j => of(j).length));
}

console.log('\nwhat is due, and daylight saving');
{
  ok('Tuesday 6 AM Eastern in September (10:00Z) runs the ROS snapshot', due(ET(2026, 9, 15, 6, 0, true)).includes('ros-snapshot') && ET(2026, 9, 15, 6, 0, true) === Date.UTC(2026, 8, 15, 10));
  ok('Tuesday 6 AM Eastern in December (11:00Z) runs it too', due(ET(2026, 12, 15, 6, 0, false)).includes('ros-snapshot') && ET(2026, 12, 15, 6, 0, false) === Date.UTC(2026, 11, 15, 11));
  ok('and 10:00Z in December, which is 5 AM Eastern, does not', !due(Date.UTC(2026, 11, 15, 10)).includes('ros-snapshot'));
  ok('Wednesday 6 AM does not run it', !due(ET(2026, 9, 16, 6, 0, true)).includes('ros-snapshot'));
  ok('a quarter past the hour runs the quarter-hourly jobs and nothing else', due(ET(2026, 9, 15, 6, 15, true)).join() === 'news-scan,content-tick');
  ok('Sunday 12:15 PM pulls the injury list before the desk tick', (() => { const d = due(ET(2026, 9, 13, 12, 15, true)); return d.indexOf('availability-refresh') >= 0 && d.indexOf('availability-refresh') < d.indexOf('content-tick') && d.includes('schedule-refresh'); })());
  ok('a Sunday 12:30 in December (17:30Z) is the same Eastern quarter', due(Date.UTC(2026, 11, 13, 17, 30)).includes('availability-refresh'));
  ok('every hour runs the schedule refresh and the desk tick', [3, 11, 17, 23].every(h => { const d = due(ET(2026, 9, 14, h, 0, true)); return d.includes('schedule-refresh') && d.includes('content-tick'); }));
  ok('Sunday 3 PM samples the lines; Monday 3 PM does not', due(ET(2026, 9, 13, 15, 0, true)).includes('market-snapshot') && !due(ET(2026, 9, 14, 15, 0, true)).includes('market-snapshot'));
  ok('Monday 4 PM does (the three-hour grid)', due(ET(2026, 9, 14, 16, 0, true)).includes('market-snapshot'));
  const wed7 = H.jobsDueAt(H.jobScheduleFrom({}).entries, ET(2026, 9, 15, 6, 0, true));
  ok('the order is phase 1, then 2, then 3, with the desk last', wed7.every((x, i) => i === 0 || x.phase >= wed7[i - 1].phase) && wed7[wed7.length - 1].job === 'content-tick');
  ok('a job with two entries is due once', due(ET(2026, 9, 13, 13, 0, true)).filter(j => j === 'market-snapshot').length === 1);
  ok('Sunday 4 AM prunes', ['snapshot-prune', 'analytics-prune', 'job-prune'].every(j => due(ET(2026, 9, 13, 4, 0, true)).includes(j)));
  ok('last season is rebuilt daily at 5 AM, before this season\'s pull', due(ET(2026, 9, 17, 5, 0, true)).includes('usage-prior-refresh') && !due(ET(2026, 9, 17, 6, 0, true)).includes('usage-prior-refresh'));
  ok('the weekly stats pull is Tuesday and Wednesday 6 AM', due(ET(2026, 9, 15, 6, 0, true)).includes('usage-refresh') && due(ET(2026, 9, 16, 6, 0, true)).includes('usage-refresh') && !due(ET(2026, 9, 17, 6, 0, true)).includes('usage-refresh'));
  ok('an hourly job runs on the hour and not at a quarter past; a quarter-hourly job runs both', due(ET(2026, 9, 15, 6, 0, true)).includes('ros-snapshot') && !due(ET(2026, 9, 15, 6, 15, true)).includes('ros-snapshot') && due(ET(2026, 9, 15, 6, 15, true)).includes('content-tick') && !due(ET(2026, 9, 15, 7, 0, true)).includes('ros-snapshot'));
}

console.log('\nthe override');
{
  const base = H.jobScheduleFrom({});
  ok('with no override the table is in force', base.source === 'default' && base.errors.length === 0 && base.entries.length === H.JOB_SCHEDULE.length);
  const o = H.jobScheduleFrom({ JOB_SCHEDULE_JSON: JSON.stringify([{ job: 'ros-snapshot', days: ['Wed', 'Fri'], hours: [8], phase: 2 }]) });
  ok('an override replaces that job\'s entries', o.source === 'env' && o.overridden.join() === 'ros-snapshot' && o.entries.filter(e => e.job === 'ros-snapshot').length === 1);
  ok('and moves it', H.jobsDueAt(o.entries, ET(2026, 9, 18, 8, 0, true)).some(x => x.job === 'ros-snapshot') && !H.jobsDueAt(o.entries, ET(2026, 9, 16, 7, 0, true)).some(x => x.job === 'ros-snapshot'));
  ok('the other jobs are untouched', o.entries.filter(e => e.job === 'market-snapshot').length === 2);
  const bad = H.jobScheduleFrom({ JOB_SCHEDULE_JSON: JSON.stringify([{ job: 'ros-snapshot', days: ['Wednesday'], hours: [7] }, { job: 'reboot', hours: 'hourly' }, { job: 'odds-refresh', hours: [25] }, { job: 'odds-refresh', hours: [9], phase: 7 }]) });
  ok('a bad day, an unknown job, a bad hour and a bad phase are each named', bad.errors.length === 4 && /Sun\.\.Sat/.test(bad.errors[0]) && /unknown job/.test(bad.errors[1]) && /0\.\.23/.test(bad.errors[2]) && /phase/.test(bad.errors[3]), bad.errors.join(' | '));
  ok('and the default entries stay in force', bad.source === 'default' && bad.entries.length === H.JOB_SCHEDULE.length && H.jobsDueAt(bad.entries, ET(2026, 9, 15, 6, 0, true)).some(x => x.job === 'ros-snapshot'));
  ok('non-JSON is an error, not a crash', H.jobScheduleFrom({ JOB_SCHEDULE_JSON: '{nope' }).errors[0] === 'JOB_SCHEDULE_JSON is not JSON');
  ok('an object instead of an array is an error', /array/.test(H.jobScheduleFrom({ JOB_SCHEDULE_JSON: '{"job":"x"}' }).errors[0]));
  const c = H.jobEntryCheck({ job: 'odds-refresh', hours: [9, 9, 3] });
  ok('hours are de-duplicated and sorted; days default to every day; phase defaults to 2', c.hours.join() === '3,9' && c.days === null && c.phase === 2);
}

console.log('\nthe report');
{
  const r = H.jobScheduleReport(H.jobScheduleFrom({}), ET(2026, 9, 15, 9, 30, true)); // Tue 9:30 AM
  const ros = r.jobs.find(j => j.job === 'ros-snapshot');
  ok('the report is in New York time and names the source', r.tz === 'America/New_York' && r.source === 'default');
  ok('a job says when it runs, in words', ros.when === 'Tue 6 AM ET', ros.when);
  ok('and the next Eastern hour it is due', ros.nextAt === ET(2026, 9, 22, 6, 0, true), String(ros.nextAt));
  ok('a quarter-hourly job says so', /at :00\/:15\/:30\/:45/.test(r.jobs.find(j => j.job === 'content-tick').when), r.jobs.find(j => j.job === 'content-tick').when);
  ok('and is next at the next quarter', r.jobs.find(j => j.job === 'content-tick').nextAt === ET(2026, 9, 15, 9, 45, true));
  ok('an hourly job is next at the top of the next hour', r.jobs.find(j => j.job === 'schedule-refresh').nextAt === ET(2026, 9, 15, 10, 0, true));
  const ms = r.jobs.find(j => j.job === 'market-snapshot');
  ok('two entries read as one sentence', /daily 1 AM, 4 AM, 7 AM, 10 AM, 1 PM, 4 PM, 7 PM, 10 PM; Sun 9 AM to 11 PM hourly ET/.test(ms.when), ms.when);
  ok('every job in the log\'s table is in the report', r.jobs.length === Object.keys(JOB_FNS).length);
  const o = H.jobScheduleReport(H.jobScheduleFrom({ JOB_SCHEDULE_JSON: JSON.stringify([{ job: 'dfs-refresh', hours: 'hourly' }]) }), ET(2026, 9, 15, 9, 30, true));
  ok('an overridden job is marked', o.jobs.find(j => j.job === 'dfs-refresh').overridden === true && o.jobs.find(j => j.job === 'dfs-refresh').when === 'daily hourly ET');
}

console.log('\nthe tick');
{
  runs.length = 0;
  const t = await H.runScheduledTick({}, ET(2026, 9, 15, 6, 0, true), '*/15 * * * *');
  ok('the tick runs what is due and reports it', t.ok && t.due.includes('ros-snapshot') && t.ran.length === t.due.length && t.ran.every(r => r.ok));
  ok('through the log, with the trigger', runs.length === t.due.length && runs.every(r => r.trigger === '*/15 * * * *'));
  const p1 = runs.filter(r => ['schedule-refresh', 'market-snapshot', 'odds-refresh', 'availability-refresh'].includes(r.job));
  const ros = runs.find(r => r.job === 'ros-snapshot'), tick = runs.find(r => r.job === 'content-tick');
  ok('phase 1 finishes before phase 2 starts, and the desk goes last', p1.every(r => r.finished <= ros.started) && ros.started <= tick.started);
  ok('the Eastern hour is on the answer', t.et.dow === 'Tue' && t.et.hour === 6 && t.et.minute === 0);
  runs.length = 0;
  const f = await H.runScheduledTick({ failOdds: true }, ET(2026, 9, 16, 7, 0, true), 'x');
  ok('a failed job is named on the tick and does not stop the others', f.ok && f.ran.find(r => r.job === 'odds-refresh').error === 'the books did not answer' && f.ran.find(r => r.job === 'content-tick').ok);
  const quiet = await H.runScheduledTick({}, ET(2026, 9, 14, 15, 0, true), 'x'); // Mon 3 PM
  ok('a quiet hour runs only the hourly jobs', quiet.due.join() === 'schedule-refresh,news-scan,league-sync,content-tick');
  ok('a bad override is on the tick\'s answer', (await H.runScheduledTick({ JOB_SCHEDULE_JSON: '[1]' }, ET(2026, 9, 14, 15, 0, true), 'x')).scheduleErrors.length === 1);
}

console.log('\nthe worker source');
{
  const wr = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  ok('the quarter-hour trigger is the only trigger; the old daily and the three social crons are gone', /"\*\/15 \* \* \* \*"/.test(wr) && !/"0 11 \* \* \*"/.test(wr) && !/"0 13 \* \* 1-5"/.test(wr) && (wr.match(/"crons": \[([^\]]*)\]/)[1].split(',').length === 1));
  const sched = cut('  async scheduled(event, env, ctx) {', '\nfunction originAllowed(');
  ok('the hourly trigger runs the tick', /event\.cron === '0 \* \* \* \*'/.test(sched) && /runScheduledTick\(env, Date\.now\(\), event\.cron\)/.test(sched));
  ok('a legacy daily trigger does nothing rather than double every pull', /event\.cron === '0 11 \* \* \*'\) \{ console\.log\('legacy/.test(sched));
  const kinds = cut('const CONTENT_KINDS = {', 'const LEGACY_CONTENT = {');
  const hour = k => { const m = kinds.match(new RegExp("'" + k + "':[^\\n]*?day: '(\\w+)', hour: (\\d+)")); return m ? m[1] + ' ' + m[2] : null; };
  const minute = k => { const m = kinds.match(new RegExp("'" + k + "':[^\\n]*?minute: (\\d+)")); return m ? Number(m[1]) : 0; };
  const gen = k => { const m = kinds.match(new RegExp("'" + k + "':[^\\n]*?generateHour: (\\d+), generateMinute: (\\d+)")); return m ? Number(m[1]) + ':' + String(m[2]).padStart(2, '0') : null; };
  ok('Sunday 12:15 PM: Last-Minute Intel', hour('last-minute-intel') === 'Sun 12' && /'last-minute-intel': \{[^}]*minute: 15/.test(kinds));
  ok('Sunday 7:30 PM: What Sunday Taught Us, updated as the night game goes final', hour('what-sunday-taught-us') === 'Sun 19' && /'what-sunday-taught-us': \{[^}]*minute: 30/.test(kinds) && /updates: 'more-finals'/.test(kinds));
  ok('Monday 6 AM: one combined Monday Morning Brief', hour('early-rankings') === 'Mon 6' && minute('early-rankings') === 0 && !hour('mnf-preview'));
  ok('Monday 12:15 PM: Quarterback Monday, gated on there being a story', hour('quarterback-monday') === 'Mon 12' && minute('quarterback-monday') === 15 && /'quarterback-monday': \{[^}]*gate: 'worth'/.test(kinds));
  ok('Tuesday: ROS rankings at 7 AM, Tailback Tuesday at 1:15 PM', hour('ros-rankings') === 'Tue 7' && minute('ros-rankings') === 0 && hour('tailback-tuesday') === 'Tue 13' && minute('tailback-tuesday') === 15);
  ok('Wednesday: Pickup Advisor at 6 AM, Wideout Wednesday at 1:15 PM', hour('pickup-advisor') === 'Wed 6' && minute('pickup-advisor') === 0 && hour('wideout-wednesday') === 'Wed 13' && minute('wideout-wednesday') === 15);
  ok('Thursday is staggered at 6:00, 10:15, 1:45 and 4:45', hour('tnf-preview') === 'Thu 6' && minute('tnf-preview') === 0 && hour('underrated') === 'Thu 10' && minute('underrated') === 15 && hour('trade-desk') === 'Thu 13' && minute('trade-desk') === 45 && hour('tight-end-thursday') === 'Thu 16' && minute('tight-end-thursday') === 45);
  ok('Friday is staggered at 6:00, 11:15 and 2:45', hour('tnf-what-matters') === 'Fri 6' && minute('tnf-what-matters') === 0 && hour('weekend-preview') === 'Fri 11' && minute('weekend-preview') === 15 && hour('kickers-defenses') === 'Fri 14' && minute('kickers-defenses') === 45);
  ok('Saturday Market Movers publishes at 11:30 AM', hour('market-movers') === 'Sat 11' && minute('market-movers') === 30);
  ok('preferred model-generation slots are all overnight', ['early-rankings','quarterback-monday','ros-rankings','tailback-tuesday','pickup-advisor','wideout-wednesday','tnf-preview','underrated','trade-desk','tight-end-thursday','tnf-what-matters','weekend-preview','kickers-defenses','market-movers'].every(k => { const x = gen(k); return x && Number(x.split(':')[0]) < 6; }));
  ok('no retired kind is on the calendar', ['mnf-preview', 'what-changed-today', 'snf-what-we-learned', 'team-recaps', 'mnf-breakdown', 'what-they-arent-telling-you', 'opportunity-report', 'rankings-update', 'final-read', 'tnf-aftermath', 'weekend-game-plan'].every(k => !new RegExp("'" + k + "': \\{").test(kinds)));
  ok('the health payload carries the schedule', /schedule: \{ tz: schedule\.tz, source: schedule\.source, errors: schedule\.errors \}/.test(src));
  const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('the admin jobs table shows the schedule and the next run', /<th>Schedule \(ET\)<\/th><th>Next<\/th>/.test(adminHtml));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
