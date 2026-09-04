#!/usr/bin/env node
// The job schedule (Step 30): one table in New York time, read by the hourly
// tick. Pins the table against the spec, the daylight-saving behaviour, the
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
const JOB_FNS = Object.fromEntries(['schedule-refresh', 'odds-refresh', 'availability-refresh', 'market-snapshot', 'usage-refresh', 'dfs-refresh', 'depth-charts', 'ros-snapshot', 'snapshot-prune', 'analytics-prune', 'job-prune', 'content-tick'].map(j => [j, async () => ({ ok: true })]));
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
  ok('the ROS, Next 3 and Weeks 15-17 recalculation is Wednesday 7 AM, phase 2', of('ros-snapshot').length === 1 && of('ros-snapshot')[0].days.join() === 'Wed' && of('ros-snapshot')[0].hours.join() === '7' && of('ros-snapshot')[0].phase === 2);
  ok('the desk tick is hourly and last', of('content-tick')[0].hours === 'hourly' && of('content-tick')[0].phase === 3);
  ok('the schedule refresh is hourly and first', of('schedule-refresh')[0].hours === 'hourly' && of('schedule-refresh')[0].phase === 1);
  ok('betting lines are sampled every three hours and hourly on Sunday', of('market-snapshot').some(e => !e.days && e.hours.length === 8) && of('market-snapshot').some(e => e.days && e.days.join() === 'Sun' && e.hours.length === 15));
  ok('the injury list refreshes more than once a day', of('availability-refresh')[0].hours.length >= 3);
  ok('rankings, injury and betting updates are independent rows, not tied to a piece', ['ros-snapshot', 'availability-refresh', 'market-snapshot'].every(j => of(j).length));
}

console.log('\nwhat is due, and daylight saving');
{
  ok('Wednesday 7 AM Eastern in September (11:00Z) runs the ROS snapshot', due(ET(2026, 9, 16, 7, 0, true)).includes('ros-snapshot') && ET(2026, 9, 16, 7, 0, true) === Date.UTC(2026, 8, 16, 11));
  ok('Wednesday 7 AM Eastern in December (12:00Z) runs it too', due(ET(2026, 12, 16, 7, 0, false)).includes('ros-snapshot') && ET(2026, 12, 16, 7, 0, false) === Date.UTC(2026, 11, 16, 12));
  ok('and 11:00Z in December, which is 6 AM Eastern, does not', !due(Date.UTC(2026, 11, 16, 11)).includes('ros-snapshot'));
  ok('Tuesday 7 AM does not run it', !due(ET(2026, 9, 15, 7, 0, true)).includes('ros-snapshot'));
  ok('every hour runs the schedule refresh and the desk tick', [3, 11, 17, 23].every(h => { const d = due(ET(2026, 9, 14, h, 0, true)); return d.includes('schedule-refresh') && d.includes('content-tick'); }));
  ok('Sunday 3 PM samples the lines; Monday 3 PM does not', due(ET(2026, 9, 13, 15, 0, true)).includes('market-snapshot') && !due(ET(2026, 9, 14, 15, 0, true)).includes('market-snapshot'));
  ok('Monday 4 PM does (the three-hour grid)', due(ET(2026, 9, 14, 16, 0, true)).includes('market-snapshot'));
  const wed7 = H.jobsDueAt(H.jobScheduleFrom({}).entries, ET(2026, 9, 16, 7, 0, true));
  ok('the order is phase 1, then 2, then 3, with the desk last', wed7.every((x, i) => i === 0 || x.phase >= wed7[i - 1].phase) && wed7[wed7.length - 1].job === 'content-tick');
  ok('a job with two entries is due once', due(ET(2026, 9, 13, 13, 0, true)).filter(j => j === 'market-snapshot').length === 1);
  ok('Sunday 4 AM prunes', ['snapshot-prune', 'analytics-prune', 'job-prune'].every(j => due(ET(2026, 9, 13, 4, 0, true)).includes(j)));
  ok('the weekly stats pull is Tuesday and Wednesday 6 AM', due(ET(2026, 9, 15, 6, 0, true)).includes('usage-refresh') && due(ET(2026, 9, 16, 6, 0, true)).includes('usage-refresh') && !due(ET(2026, 9, 17, 6, 0, true)).includes('usage-refresh'));
  ok('the minute does not matter; the hour does', due(ET(2026, 9, 16, 7, 59, true)).includes('ros-snapshot') && !due(ET(2026, 9, 16, 8, 0, true)).includes('ros-snapshot'));
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
  ok('and the default entries stay in force', bad.source === 'default' && bad.entries.length === H.JOB_SCHEDULE.length && H.jobsDueAt(bad.entries, ET(2026, 9, 16, 7, 0, true)).some(x => x.job === 'ros-snapshot'));
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
  ok('a job says when it runs, in words', ros.when === 'Wed 7 AM ET', ros.when);
  ok('and the next Eastern hour it is due', ros.nextAt === ET(2026, 9, 16, 7, 0, true), String(ros.nextAt));
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
  const t = await H.runScheduledTick({}, ET(2026, 9, 16, 7, 0, true), '0 * * * *');
  ok('the tick runs what is due and reports it', t.ok && t.due.includes('ros-snapshot') && t.ran.length === t.due.length && t.ran.every(r => r.ok));
  ok('through the log, with the trigger', runs.length === t.due.length && runs.every(r => r.trigger === '0 * * * *'));
  const p1 = runs.filter(r => ['schedule-refresh', 'market-snapshot', 'odds-refresh', 'availability-refresh'].includes(r.job));
  const ros = runs.find(r => r.job === 'ros-snapshot'), tick = runs.find(r => r.job === 'content-tick');
  ok('phase 1 finishes before phase 2 starts, and the desk goes last', p1.every(r => r.finished <= ros.started) && ros.started <= tick.started);
  ok('the Eastern hour is on the answer', t.et.dow === 'Wed' && t.et.hour === 7);
  runs.length = 0;
  const f = await H.runScheduledTick({ failOdds: true }, ET(2026, 9, 16, 7, 0, true), 'x');
  ok('a failed job is named on the tick and does not stop the others', f.ok && f.ran.find(r => r.job === 'odds-refresh').error === 'the books did not answer' && f.ran.find(r => r.job === 'content-tick').ok);
  const quiet = await H.runScheduledTick({}, ET(2026, 9, 14, 15, 0, true), 'x'); // Mon 3 PM
  ok('a quiet hour runs only the hourly jobs', quiet.due.join() === 'schedule-refresh,content-tick');
  ok('a bad override is on the tick\'s answer', (await H.runScheduledTick({ JOB_SCHEDULE_JSON: '[1]' }, ET(2026, 9, 14, 15, 0, true), 'x')).scheduleErrors.length === 1);
}

console.log('\nthe worker source');
{
  const wr = fs.readFileSync(path.join(ROOT, 'wrangler.jsonc'), 'utf8');
  ok('the hourly trigger is configured and the old daily one is gone', /"0 \* \* \* \*"/.test(wr) && !/"0 11 \* \* \*"/.test(wr));
  const sched = cut('  async scheduled(event, env, ctx) {', '\nfunction originAllowed(');
  ok('the hourly trigger runs the tick', /event\.cron === '0 \* \* \* \*'/.test(sched) && /runScheduledTick\(env, Date\.now\(\), event\.cron\)/.test(sched));
  ok('a legacy daily trigger does nothing rather than double every pull', /event\.cron === '0 11 \* \* \*'\) \{ console\.log\('legacy/.test(sched));
  const kinds = cut('const CONTENT_KINDS = {', 'const DOW_N = {');
  const hour = k => { const m = kinds.match(new RegExp("'" + k + "':[^\\n]*?day: '(\\w+)', hour: (\\d+)")); return m ? m[1] + ' ' + m[2] : null; };
  ok('Sunday 8 PM: What Changed Today', hour('what-changed-today') === 'Sun 20');
  ok('Monday 1 AM: the SNF piece', hour('snf-what-we-learned') === 'Mon 1');
  ok('Monday 7 AM: the recaps', hour('team-recaps') === 'Mon 7');
  ok('Tuesday 7 AM: What They Aren\'t Telling You and the MNF piece', hour('what-they-arent-telling-you') === 'Tue 7' && hour('mnf-breakdown') === 'Tue 7');
  ok('Wednesday 7 AM: the Opportunity Report and the rankings update', hour('opportunity-report') === 'Wed 7' && hour('rankings-update') === 'Wed 7');
  ok('Thursday 7 AM: the Final Read and the TNF preview', hour('final-read') === 'Thu 7' && hour('tnf-preview') === 'Thu 7');
  ok('Friday 7 AM: the TNF aftermath and the Weekend Game Plan', hour('tnf-aftermath') === 'Fri 7' && hour('weekend-game-plan') === 'Fri 7');
  ok('the health payload carries the schedule', /schedule: \{ tz: schedule\.tz, source: schedule\.source, errors: schedule\.errors \}/.test(src));
  const adminHtml = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  ok('the admin jobs table shows the schedule and the next run', /<th>Schedule \(ET\)<\/th><th>Next<\/th>/.test(adminHtml));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
