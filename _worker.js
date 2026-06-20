// Cloudflare Pages — advanced mode single Worker.
// Serves the static app AND the /api/coach LLM proxy. The API key stays server-side.
//
// Set in Cloudflare Pages -> Settings -> Environment variables:
//   LLM_API_KEY   (required, mark Encrypt)   OpenAI sk-...  or  Anthropic sk-ant-...
//   LLM_PROVIDER  (optional)  "openai" (default) | "anthropic"
//   LLM_MODEL     (optional)  gpt-4o-mini  /  claude-3-5-haiku-latest
//   ALLOWED_ORIGIN(optional)  your https://<project>.pages.dev  (locks the proxy to your site)
//   LLM_ENDPOINT  (optional)  OpenAI-compatible endpoint override
//   TURNSTILE_SECRET (optional) require a Turnstile token

const corsHeaders = (origin) => ({
  'access-control-allow-origin': origin || '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'vary': 'Origin',
});
const json = (obj, status, c) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', ...c } });

// ── projections data kept server-side (not shipped in the client HTML) ──
const IT_KEY = 'IT_pk_7c1a93f0';
const PROJ_KEY = 'tn$9xQ27z';
function _xb64encode(str, key) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i] ^ key.charCodeAt(i % key.length));
  return btoa(bin);
}
const PROJECTIONS = [

  // ── QB (CBS/SportsLine 2026, adjusted) ──
  { name: "Josh Allen", position: "QB", team: "BUF", projectedStats: { passYd: 3944, passTD: 25, passInt: 12, rushYd: 577, rushTD: 11, fumLost: 0 }},
  { name: "Lamar Jackson", position: "QB", team: "BAL", projectedStats: { passYd: 3887, passTD: 25, passInt: 10, rushYd: 667, rushTD: 3, fumLost: 0 }},
  { name: "Drake Maye", position: "QB", team: "NE", projectedStats: { passYd: 4092, passTD: 26, passInt: 11, rushYd: 529, rushTD: 3, fumLost: 0 }},
  { name: "Jayden Daniels", position: "QB", team: "WAS", projectedStats: { passYd: 3851, passTD: 21, passInt: 10, rushYd: 672, rushTD: 4, fumLost: 0 }},
  { name: "Dak Prescott", position: "QB", team: "DAL", projectedStats: { passYd: 4115, passTD: 29, passInt: 12, rushYd: 189, rushTD: 3, fumLost: 0 }},
  { name: "Joe Burrow", position: "QB", team: "CIN", projectedStats: { passYd: 4117, passTD: 32, passInt: 11, rushYd: 187, rushTD: 3, fumLost: 0 }},
  { name: "Jalen Hurts", position: "QB", team: "PHI", projectedStats: { passYd: 3780, passTD: 25, passInt: 9, rushYd: 436, rushTD: 8, fumLost: 0 }},
  { name: "Trevor Lawrence", position: "QB", team: "JAX", projectedStats: { passYd: 3926, passTD: 24, passInt: 13, rushYd: 336, rushTD: 6, fumLost: 0 }},
  { name: "Jaxson Dart", position: "QB", team: "NYG", projectedStats: { passYd: 3686, passTD: 21, passInt: 10, rushYd: 555, rushTD: 7, fumLost: 0 }},
  { name: "Brock Purdy", position: "QB", team: "SF", projectedStats: { passYd: 4183, passTD: 28, passInt: 14, rushYd: 274, rushTD: 5, fumLost: 0 }},
  { name: "Patrick Mahomes", position: "QB", team: "KC", projectedStats: { passYd: 3992, passTD: 27, passInt: 12, rushYd: 327, rushTD: 4, fumLost: 0 }},
  { name: "Matthew Stafford", position: "QB", team: "LAR", projectedStats: { passYd: 4046, passTD: 34, passInt: 7, rushYd: 38, fumLost: 2 }},
  { name: "Daniel Jones", position: "QB", team: "IND", projectedStats: { passYd: 3746, passTD: 21, passInt: 11, rushYd: 305, rushTD: 7, fumLost: 0 }},
  { name: "Justin Herbert", position: "QB", team: "LAC", projectedStats: { passYd: 3845, passTD: 25, passInt: 11, rushYd: 409, rushTD: 1, fumLost: 0 }},
  { name: "Jared Goff", position: "QB", team: "DET", projectedStats: { passYd: 4231, passTD: 35, passInt: 10, rushYd: 42, fumLost: 4 }},
  { name: "Caleb Williams", position: "QB", team: "CHI", projectedStats: { passYd: 3819, passTD: 24, passInt: 10, rushYd: 383, rushTD: 3, fumLost: 0 }},
  { name: "Baker Mayfield", position: "QB", team: "TB", projectedStats: { passYd: 3944, passTD: 30, passInt: 15, rushYd: 398, rushTD: 3, fumLost: 3 }},
  { name: "Malik Willis", position: "QB", team: "MIA", projectedStats: { passYd: 3551, passTD: 13, passInt: 10, rushYd: 542, rushTD: 3, fumLost: 0 }},
  { name: "Sam Darnold", position: "QB", team: "SEA", projectedStats: { passYd: 4120, passTD: 31, passInt: 13, rushYd: 150, fumLost: 6 }},
  { name: "Bo Nix", position: "QB", team: "DEN", projectedStats: { passYd: 3874, passTD: 27, passInt: 11, rushYd: 358, rushTD: 5, fumLost: 0 }},
  { name: "C.J. Stroud", position: "QB", team: "HOU", projectedStats: { passYd: 3936, passTD: 28, passInt: 12, rushYd: 248, rushTD: 1, fumLost: 3 }},
  { name: "Tyler Shough", position: "QB", team: "NO", projectedStats: { passYd: 3886, passTD: 20, passInt: 11, rushYd: 281, rushTD: 4, fumLost: 0 }},
  { name: "Kyler Murray", position: "QB", team: "MIN", projectedStats: { passYd: 3344, passTD: 20, passInt: 10, rushYd: 441, rushTD: 2, fumLost: 0 }},
  { name: "Jordan Love", position: "QB", team: "GB", projectedStats: { passYd: 3680, passTD: 28, passInt: 10, rushYd: 183, fumLost: 2 }},
  { name: "Jacoby Brissett", position: "QB", team: "ARI", projectedStats: { passYd: 3770, passTD: 25, passInt: 12, rushYd: 260, rushTD: 2, fumLost: 6 }},
  { name: "Tua Tagovailoa", position: "QB", team: "ATL", projectedStats: { passYd: 3458, passTD: 25, passInt: 10, rushYd: 53, fumLost: 2 }},
  { name: "Bryce Young", position: "QB", team: "CAR", projectedStats: { passYd: 3636, passTD: 20, passInt: 12, rushYd: 271, rushTD: 2, fumLost: 0 }},
  { name: "Aaron Rodgers", position: "QB", team: "PIT", projectedStats: { passYd: 3077, passTD: 25, passInt: 9, rushYd: 73, rushTD: 2, fumLost: 2 }},
  { name: "Cam Ward", position: "QB", team: "TEN", projectedStats: { passYd: 3757, passTD: 16, passInt: 10, rushYd: 201, rushTD: 2, fumLost: 0 }},
  { name: "Geno Smith", position: "QB", team: "NYJ", projectedStats: { passYd: 2937, passTD: 23, passInt: 16, rushYd: 247, rushTD: 0, fumLost: 1 }},
  { name: "Fernando Mendoza", position: "QB", team: "LV", projectedStats: { passYd: 2634, passTD: 19, passInt: 16, rushYd: 237, rushTD: 1, fumLost: 2 }},
  { name: "Deshaun Watson", position: "QB", team: "CLE", projectedStats: { passYd: 1880, passTD: 11, passInt: 12, rushYd: 186, rushTD: 3, fumLost: 4 }},
  { name: "Shedeur Sanders", position: "QB", team: "CLE", projectedStats: { passYd: 1258, passTD: 9, passInt: 8, rushYd: 128, rushTD: 0, fumLost: 1 }},
  { name: "Ty Simpson", position: "QB", team: "LAR", projectedStats: { passYd: 455, passTD: 4, passInt: 1, rushYd: 32 }},
  { name: "Michael Penix Jr.", position: "QB", team: "ATL", projectedStats: { passYd: 612, passTD: 4, passInt: 2, rushYd: 20 }},
  { name: "Kirk Cousins", position: "QB", team: "LV", projectedStats: { passYd: 674, passTD: 5, passInt: 4, rushYd: 9, fumLost: 1 }},
  { name: "Marcus Mariota", position: "QB", team: "WAS", projectedStats: { passYd: 349, passTD: 2, passInt: 1, rushYd: 4 }},
  { name: "Quinn Ewers", position: "QB", team: "MIA", projectedStats: { passYd: 126, passTD: 0, passInt: 1, rushYd: 23, rec: 6, recYd: 0, recTD: 0 }},
  { name: "Desmond Ridder", position: "QB", team: "GB", projectedStats: { passYd: 154, passTD: 0, passInt: 0, rushYd: 22 }},
  { name: "Joe Milton III", position: "QB", team: "DAL", projectedStats: { passYd: 175, passTD: 0, passInt: 0, rushYd: 17 }},
  { name: "Tyler Huntley", position: "QB", team: "BAL", projectedStats: { passYd: 133, passTD: 0, passInt: 0, rushYd: 28 }},
  { name: "Davis Mills", position: "QB", team: "HOU", projectedStats: { passYd: 161, passTD: 2, passInt: 0, rushYd: 21 }},
  { name: "Shane Buechele", position: "QB", team: "BUF", projectedStats: { passYd: 146, passTD: 0, passInt: 0, rushYd: 20 }},
  { name: "Mason Rudolph", position: "QB", team: "PIT", projectedStats: { passYd: 132, passTD: 1, passInt: 0, rushYd: 15 }},
  { name: "Jarrett Stidham", position: "QB", team: "DEN", projectedStats: { passYd: 147, passTD: 0, passInt: 0, rushYd: 19 }},
  { name: "Will Levis", position: "QB", team: "TEN", projectedStats: { passYd: 128, passTD: 1, passInt: 0, rushYd: 17 }},
  { name: "Gardner Minshew", position: "QB", team: "ARI", projectedStats: { passYd: 156, passTD: 0, passInt: 0, rushYd: 18 }},
  { name: "Garrett Nussmeier", position: "QB", team: "KC", projectedStats: { passYd: 113, passTD: 2, passInt: 0, rushYd: 2 }},
  { name: "Behren Morton", position: "QB", team: "NE", projectedStats: { passYd: 120, passTD: 0, passInt: 0, rushYd: 10 }},
  { name: "Seth Henigan", position: "QB", team: "IND", projectedStats: { passYd: 127, passTD: 1, passInt: 0, rushYd: 5 }},
  { name: "Joshua Dobbs", position: "QB", team: "NE", projectedStats: { passYd: 155, passTD: 1, passInt: 0, rushYd: 15 }},
  { name: "Tanner McKee", position: "QB", team: "PHI", projectedStats: { passYd: 130, passTD: 1, passInt: 0, rushYd: 17 }},
  { name: "Teddy Bridgewater", position: "QB", team: "DET", projectedStats: { passYd: 164, passTD: 2, passInt: 0, rushYd: 13 }},
  { name: "Cade Klubnik", position: "QB", team: "NYJ", projectedStats: { passYd: 90, passTD: 0, passInt: 0, rushYd: 10 }},
  { name: "Tyson Bagent", position: "QB", team: "CHI", projectedStats: { passYd: 149, passTD: 1, passInt: 0, rushYd: 14 }},
  { name: "Mitch Trubisky", position: "QB", team: "TEN", projectedStats: { passYd: 111, passTD: 2, passInt: 0, rushYd: 3 }},
  { name: "Cole Payton", position: "QB", team: "PHI", projectedStats: { passYd: 105, passTD: 1, passInt: 0, rushYd: 4 }},
  { name: "Adrian Martinez", position: "QB", team: "SF", projectedStats: { passYd: 117, passTD: 2, passInt: 0, rushYd: 7 }},
  { name: "Carson Beck", position: "QB", team: "ARI", projectedStats: { passYd: 115, passTD: 1, passInt: 0, rushYd: 13 }},
  { name: "Kyle Allen", position: "QB", team: "BUF", projectedStats: { passYd: 93, passTD: 0, passInt: 0, rushYd: 0 }},
  { name: "Will Howard", position: "QB", team: "PIT", projectedStats: { passYd: 105, passTD: 2, passInt: 0, rushYd: 3 }},
  { name: "Nick Mullens", position: "QB", team: "JAX", projectedStats: { passYd: 106, passTD: 1, passInt: 0, rushYd: 6 }},
  { name: "Jalen Milroe", position: "QB", team: "SEA", projectedStats: { passYd: 93, passTD: 0, passInt: 0, rushYd: 19 }},
  { name: "Drew Allar", position: "QB", team: "PIT", projectedStats: { passYd: 108, passTD: 1, passInt: 0, rushYd: 6 }},
  // ── RB (CBS/SportsLine 2026, adjusted) ──
  { name: "Bijan Robinson", position: "RB", team: "ATL", projectedStats: { rushYd: 1374, rushTD: 7, rec: 77, recYd: 710, recTD: 4, fumLost: 0 }},
  { name: "Jahmyr Gibbs", position: "RB", team: "DET", projectedStats: { rushYd: 1376, rushTD: 15, rec: 67, recYd: 546, recTD: 4, fumLost: 0 }},
  { name: "Jonathan Taylor", position: "RB", team: "IND", projectedStats: { rushYd: 1511, rushTD: 12, rec: 46, recYd: 349, recTD: 1, fumLost: 0 }},
  { name: "Derrick Henry", position: "RB", team: "BAL", projectedStats: { rushYd: 1483, rushTD: 12, rec: 20, recYd: 208, recTD: 0, fumLost: 0 }},
  { name: "De'Von Achane", position: "RB", team: "MIA", projectedStats: { rushYd: 1346, rushTD: 5, rec: 64, recYd: 513, recTD: 3, fumLost: 0 }},
  { name: "Christian McCaffrey", position: "RB", team: "SF", projectedStats: { rushYd: 1152, rushTD: 11, rec: 79, recYd: 690, recTD: 6, fumLost: 0 }},
  { name: "Chase Brown", position: "RB", team: "CIN", projectedStats: { rushYd: 1043, rushTD: 6, rec: 63, recYd: 436, recTD: 2, fumLost: 0 }},
  { name: "Ashton Jeanty", position: "RB", team: "LV", projectedStats: { rushYd: 1139, rushTD: 6, rec: 63, recYd: 497, recTD: 3, fumLost: 0 }},
  { name: "James Cook", position: "RB", team: "BUF", projectedStats: { rushYd: 1435, rushTD: 8, rec: 31, recYd: 267, recTD: 3, fumLost: 3 }},
  { name: "Saquon Barkley", position: "RB", team: "PHI", projectedStats: { rushYd: 1287, rushTD: 9, rec: 44, recYd: 368, recTD: 2, fumLost: 0 }},
  { name: "Josh Jacobs", position: "RB", team: "GB", projectedStats: { rushYd: 1236, rushTD: 12, rec: 34, recYd: 280, recTD: 1, fumLost: 0 }},
  { name: "Cam Skattebo", position: "RB", team: "NYG", projectedStats: { rushYd: 1051, rushTD: 7, rec: 51, recYd: 364, recTD: 2, fumLost: 0 }},
  { name: "Kyren Williams", position: "RB", team: "LAR", projectedStats: { rushYd: 1136, rushTD: 11, rec: 32, recYd: 226, recTD: 2, fumLost: 0 }},
  { name: "Breece Hall", position: "RB", team: "NYJ", projectedStats: { rushYd: 1165, rushTD: 8, rec: 50, recYd: 437, recTD: 3, fumLost: 0 }},
  { name: "Omarion Hampton", position: "RB", team: "LAC", projectedStats: { rushYd: 939, rushTD: 10, rec: 48, recYd: 298, recTD: 3, fumLost: 1 }},
  { name: "Bucky Irving", position: "RB", team: "TB", projectedStats: { rushYd: 1060, rushTD: 5, rec: 38, recYd: 315, recTD: 1, fumLost: 0 }},
  { name: "Travis Etienne", position: "RB", team: "NO", projectedStats: { rushYd: 1115, rushTD: 5, rec: 43, recYd: 377, recTD: 1, fumLost: 0 }},
  { name: "D'Andre Swift", position: "RB", team: "CHI", projectedStats: { rushYd: 993, rushTD: 9, rec: 31, recYd: 273, recTD: 0, fumLost: 0 }},
  { name: "Jeremiyah Love", position: "RB", team: "ARI", projectedStats: { rushYd: 1131, rushTD: 8, rec: 67, recYd: 486, recTD: 1, fumLost: 0 }},
  { name: "Javonte Williams", position: "RB", team: "DAL", projectedStats: { rushYd: 1253, rushTD: 10, rec: 39, recYd: 221, recTD: 1, fumLost: 0 }},
  { name: "Kenneth Walker III", position: "RB", team: "KC", projectedStats: { rushYd: 1234, rushTD: 8, rec: 47, recYd: 375, recTD: 3, fumLost: 0 }},
  { name: "Rico Dowdle", position: "RB", team: "PIT", projectedStats: { rushYd: 973, rushTD: 6, rec: 30, recYd: 212, recTD: 0, fumLost: 0 }},
  { name: "Bhayshul Tuten", position: "RB", team: "JAX", projectedStats: { rushYd: 995, rushTD: 7, rec: 35, recYd: 252, recTD: 1, fumLost: 0 }},
  { name: "TreVeyon Henderson", position: "RB", team: "NE", projectedStats: { rushYd: 853, rushTD: 7, rec: 42, recYd: 302, recTD: 2, fumLost: 0 }},
  { name: "Quinshon Judkins", position: "RB", team: "CLE", projectedStats: { rushYd: 1237, rushTD: 6, rec: 34, recYd: 222, recTD: 2, fumLost: 0 }},
  { name: "RJ Harvey", position: "RB", team: "DEN", projectedStats: { rushYd: 432, rushTD: 3, rec: 51, recYd: 365, recTD: 4, fumLost: 0 }},
  { name: "Jaylen Warren", position: "RB", team: "PIT", projectedStats: { rushYd: 786, rushTD: 4, rec: 47, recYd: 317, recTD: 1, fumLost: 0 }},
  { name: "Jadarian Price", position: "RB", team: "SEA", projectedStats: { rushYd: 919, rushTD: 8, rec: 29, recYd: 210, recTD: 1, fumLost: 0 }},
  { name: "David Montgomery", position: "RB", team: "HOU", projectedStats: { rushYd: 933, rushTD: 8, rec: 33, recYd: 234, recTD: 0, fumLost: 0 }},
  { name: "Rhamondre Stevenson", position: "RB", team: "NE", projectedStats: { rushYd: 723, rushTD: 7, rec: 36, recYd: 311, recTD: 2, fumLost: 0 }},
  { name: "Tony Pollard", position: "RB", team: "TEN", projectedStats: { rushYd: 1073, rushTD: 6, rec: 31, recYd: 182, recTD: 0, fumLost: 0 }},
  { name: "Chuba Hubbard", position: "RB", team: "CAR", projectedStats: { rushYd: 795, rushTD: 4, rec: 42, recYd: 305, recTD: 1, fumLost: 0 }},
  { name: "J.K. Dobbins", position: "RB", team: "DEN", projectedStats: { rushYd: 1010, rushTD: 8, rec: 19, recYd: 108, recTD: 2, fumLost: 0 }},
  { name: "Kenneth Gainwell", position: "RB", team: "TB", projectedStats: { rushYd: 537, rushTD: 3, rec: 59, recYd: 433, recTD: 3, fumLost: 1 }},
  { name: "Jordan Mason", position: "RB", team: "MIN", projectedStats: { rushYd: 745, rushTD: 6, rec: 15, recYd: 82, recTD: 0, fumLost: 0 }},
  { name: "Jacory Croskey-Merritt", position: "RB", team: "WAS", projectedStats: { rushYd: 847, rushTD: 8, rec: 15, recYd: 87, recTD: 0, fumLost: 0 }},
  { name: "Aaron Jones", position: "RB", team: "MIN", projectedStats: { rushYd: 737, rushTD: 4, rec: 46, recYd: 342, recTD: 2, fumLost: 0 }},
  { name: "Kyle Monangai", position: "RB", team: "CHI", projectedStats: { rushYd: 822, rushTD: 5, rec: 27, recYd: 212, recTD: 0, fumLost: 0 }},
  { name: "Rachaad White", position: "RB", team: "WAS", projectedStats: { rushYd: 566, rushTD: 5, rec: 46, recYd: 293, recTD: 2, fumLost: 0 }},
  { name: "Tyrone Tracy Jr.", position: "RB", team: "NYG", projectedStats: { rushYd: 618, rushTD: 4, rec: 30, recYd: 248, recTD: 3, fumLost: 1 }},
  { name: "Blake Corum", position: "RB", team: "LAR", projectedStats: { rushYd: 772, rushTD: 6, rec: 18, recYd: 116, recTD: 2, fumLost: 0 }},
  { name: "Woody Marks", position: "RB", team: "HOU", projectedStats: { rushYd: 562, rushTD: 3, rec: 22, recYd: 176, recTD: 3, fumLost: 1 }},
  { name: "Chris Rodriguez Jr.", position: "RB", team: "JAC", projectedStats: { rushYd: 673, rushTD: 7, rec: 3, recYd: 16, recTD: 0, fumLost: 1 }},
  { name: "Zach Charbonnet", position: "RB", team: "SEA", projectedStats: { rushYd: 502, rushTD: 7, rec: 22, recYd: 164, recTD: 0, fumLost: 1 }},
  { name: "Tyjae Spears", position: "RB", team: "TEN", projectedStats: { rushYd: 408, rushTD: 3, rec: 51, recYd: 332, recTD: 2, fumLost: 0 }},
  { name: "Isiah Pacheco", position: "RB", team: "DET", projectedStats: { rushYd: 614, rushTD: 4, rec: 27, recYd: 155, recTD: 2, fumLost: 1 }},
  { name: "Jonathon Brooks", position: "RB", team: "CAR", projectedStats: { rushYd: 679, rushTD: 3, rec: 30, recYd: 214, recTD: 0, fumLost: 0 }},
  { name: "Kaelon Black", position: "RB", team: "SF", projectedStats: { rushYd: 591, rushTD: 4, rec: 12, recYd: 128, recTD: 2, fumLost: 2 }},
  { name: "Jordan James", position: "RB", team: "SF", projectedStats: { rushYd: 498, rushTD: 3, rec: 26, recYd: 234, recTD: 2, fumLost: 2 }},
  { name: "James Conner", position: "RB", team: "ARI", projectedStats: { rushYd: 312, rushTD: 3, rec: 35, recYd: 263, recTD: 2 }},
  { name: "Justice Hill", position: "RB", team: "BAL", projectedStats: { rushYd: 222, rushTD: 1, rec: 38, recYd: 348, recTD: 2, fumLost: 0 }},
  { name: "Dylan Sampson", position: "RB", team: "CLE", projectedStats: { rushYd: 282, rushTD: 1, rec: 35, recYd: 308, recTD: 4, fumLost: 2 }},
  { name: "Adam Randall", position: "RB", team: "BAL", projectedStats: { rushYd: 437, rushTD: 4, rec: 18, recYd: 178, recTD: 3, fumLost: 1 }},
  { name: "Brian Robinson Jr.", position: "RB", team: "ATL", projectedStats: { rushYd: 572, rushTD: 5, rec: 4, recYd: 25, recTD: 0, fumLost: 1 }},
  { name: "Malik Davis", position: "RB", team: "DAL", projectedStats: { rushYd: 555, rushTD: 3, rec: 7, recYd: 79, recTD: 1 }},
  { name: "Tyler Allgeier", position: "RB", team: "ARI", projectedStats: { rushYd: 466, rushTD: 5, rec: 18, recYd: 91, recTD: 0, fumLost: 1 }},
  { name: "Emari Demercado", position: "RB", team: "KC", projectedStats: { rushYd: 600, rushTD: 2, rec: 19, recYd: 132, recTD: 1, fumLost: 3 }},
  { name: "Ty Johnson", position: "RB", team: "BUF", projectedStats: { rushYd: 219, rushTD: 3, rec: 26, recYd: 274, recTD: 4 }},
  { name: "Braelon Allen", position: "RB", team: "NYJ", projectedStats: { rushYd: 436, rushTD: 6, rec: 11, recYd: 95, recTD: 2, fumLost: 3 }},
  { name: "Emanuel Wilson", position: "RB", team: "SEA", projectedStats: { rushYd: 534, rushTD: 3, rec: 16, recYd: 89, recTD: 0, fumLost: 1 }},
  { name: "Christopher Brooks", position: "RB", team: "GB", projectedStats: { rushYd: 548, rushTD: 3, rec: 13, recYd: 108, recTD: 1, fumLost: 1 }},
  { name: "AJ Dillon", position: "RB", team: "CAR", projectedStats: { rushYd: 497, rushTD: 4, rec: 15, recYd: 130, recTD: 2, fumLost: 5 }},
  { name: "Jawhar Jordan", position: "RB", team: "HOU", projectedStats: { rushYd: 379, rushTD: 2, rec: 22, recYd: 173, recTD: 1, fumLost: 1 }},
  { name: "Samaje Perine", position: "RB", team: "CIN", projectedStats: { rushYd: 442, rushTD: 2, rec: 21, recYd: 137, recTD: 2, fumLost: 0 }},
  { name: "Mike Washington Jr.", position: "RB", team: "LV", projectedStats: { rushYd: 339, rushTD: 1, rec: 24, recYd: 180, recTD: 0, fumLost: 1 }},
  { name: "Keaton Mitchell", position: "RB", team: "LAC", projectedStats: { rushYd: 502, rushTD: 1, rec: 12, recYd: 66, recTD: 0, fumLost: 1 }},
  { name: "Kimani Vidal", position: "RB", team: "LAC", projectedStats: { rushYd: 352, rushTD: 1, rec: 15, recYd: 148, recTD: 2 }},
  { name: "Kendre Miller", position: "RB", team: "NO", projectedStats: { rushYd: 362, rushTD: 3, rec: 10, recYd: 63, recTD: 1 }},
  { name: "Tank Bigsby", position: "RB", team: "PHI", projectedStats: { rushYd: 466, rushTD: 3, rec: 4, recYd: 36, recTD: 0 }},
  { name: "Kyle Juszczyk", position: "RB", team: "SF", projectedStats: { rushYd: 0, rec: 28, recYd: 252, recTD: 2 }},
  { name: "Jaylen Wright", position: "RB", team: "MIA", projectedStats: { rushYd: 390, rushTD: 3, rec: 6, recYd: 45, recTD: 0, fumLost: 2 }},
  { name: "Brashard Smith", position: "RB", team: "KC", projectedStats: { rushYd: 182, rushTD: 0, rec: 22, recYd: 144, recTD: 0 }},
  { name: "Devin Neal", position: "RB", team: "NO", projectedStats: { rushYd: 176, rushTD: 3, rec: 4, recYd: 30, recTD: 0 }},
  { name: "Frank Gore Jr.", position: "RB", team: "BUF", projectedStats: { rushYd: 178, rushTD: 1, rec: 2, recYd: 29, recTD: 0 }},
  { name: "Roschon Johnson", position: "RB", team: "CHI", projectedStats: { rushYd: 120, rushTD: 2, rec: 5, recYd: 13, recTD: 0 }},
  { name: "Jerome Ford", position: "RB", team: "WAS", projectedStats: { rushYd: 194, rushTD: 2, rec: 7, recYd: 47, recTD: 1 }},
  { name: "Isaiah Davis", position: "RB", team: "NYJ", projectedStats: { rushYd: 166, rushTD: 0, rec: 5, recYd: 58, recTD: 0 }},
  { name: "Phil Mafah", position: "RB", team: "DAL", projectedStats: { rushYd: 142, rushTD: 2, rec: 2, recYd: 40, recTD: 0 }},
  { name: "Ty Chandler", position: "RB", team: "NO", projectedStats: { rushYd: 144, rushTD: 2, rec: 13, recYd: 56, recTD: 0 }},
  { name: "Seth McGowan", position: "RB", team: "IND", projectedStats: { rushYd: 147, rushTD: 1, rec: 3, recYd: 26, recTD: 0 }},
  { name: "Sean Tucker", position: "RB", team: "TB", projectedStats: { rushYd: 141, rushTD: 3, rec: 0, recYd: 4, recTD: 0 }},
  { name: "Kaytron Allen", position: "RB", team: "WAS", projectedStats: { rushYd: 169, rushTD: 2, rec: 3, recYd: 21, recTD: 0 }},
  { name: "Austin Ekeler", position: "RB", team: "WAS", projectedStats: { rushYd: 151, rushTD: 1, rec: 5, recYd: 63, recTD: 0 }},
  { name: "Michael Burton", position: "RB", team: "CLE", projectedStats: { rushYd: 10, rushTD: 2, rec: 5, recYd: 43, recTD: 2 }},
  { name: "Andrew Beck", position: "RB", team: "NYJ", projectedStats: { rushYd: 12, rec: 3, recYd: 31, recTD: 2 }},
  { name: "Jeremy McNichols", position: "RB", team: "WAS", projectedStats: { rushYd: 87, rushTD: 0, rec: 6, recYd: 53, recTD: 1 }},
  { name: "Isaac Guerendo", position: "RB", team: "SF", projectedStats: { rushYd: 159, rushTD: 2, rec: 3, recYd: 34, recTD: 1 }},
  { name: "Ameer Abdullah", position: "RB", team: "JAX", projectedStats: { rushYd: 74, rushTD: 1, rec: 6, recYd: 54, recTD: 0 }},
  { name: "Jam Miller", position: "RB", team: "NE", projectedStats: { rushYd: 153, rushTD: 0, rec: 4, recYd: 21, recTD: 1 }},
  { name: "Dare Ogunbowale", position: "RB", team: "HOU", projectedStats: { rushYd: 69, rushTD: 2, rec: 5, recYd: 64, recTD: 0 }},
  { name: "Elijah Mitchell", position: "RB", team: "PHI", projectedStats: { rushYd: 160, rushTD: 2, rec: 4, recYd: 19, recTD: 1 }},
  { name: "Zavier Scott", position: "RB", team: "MIN", projectedStats: { rushYd: 104, rec: 7, recYd: 46, recTD: 2 }},
  // ── WR (CBS/SportsLine 2026, adjusted) ──
  { name: "Jaxon Smith-Njigba", position: "WR", team: "SEA", projectedStats: { rushYd: 28, rushTD: 0, rec: 115, recYd: 1570, recTD: 10, fumLost: 0 }},
  { name: "Puka Nacua", position: "WR", team: "LAR", projectedStats: { rushYd: 105, rushTD: 1, rec: 121, recYd: 1591, recTD: 9, fumLost: 0 }},
  { name: "Ja'Marr Chase", position: "WR", team: "CIN", projectedStats: { rushYd: 20, rushTD: 0, rec: 118, recYd: 1506, recTD: 11, fumLost: 0 }},
  { name: "Drake London", position: "WR", team: "ATL", projectedStats: { rushYd: 0, rushTD: 0, rec: 103, recYd: 1255, recTD: 7, fumLost: 0 }},
  { name: "Amon-Ra St. Brown", position: "WR", team: "DET", projectedStats: { rushYd: 16, rushTD: 0, rec: 116, recYd: 1429, recTD: 11, fumLost: 0 }},
  { name: "Rashee Rice", position: "WR", team: "KC", projectedStats: { rushYd: 44, rushTD: 1, rec: 98, recYd: 1135, recTD: 10, fumLost: 0 }},
  { name: "George Pickens", position: "WR", team: "DAL", projectedStats: { rushYd: 0, rushTD: 1, rec: 81, recYd: 1115, recTD: 7, fumLost: 0 }},
  { name: "Chris Olave", position: "WR", team: "NO", projectedStats: { rushYd: 0, rushTD: 1, rec: 91, recYd: 1161, recTD: 5, fumLost: 0 }},
  { name: "A.J. Brown", position: "WR", team: "NE", projectedStats: { rushYd: 0, rushTD: 0, rec: 84, recYd: 1216, recTD: 7, fumLost: 0 }},
  { name: "CeeDee Lamb", position: "WR", team: "DAL", projectedStats: { rushYd: 16, rushTD: 0, rec: 106, recYd: 1383, recTD: 9, fumLost: 0 }},
  { name: "Nico Collins", position: "WR", team: "HOU", projectedStats: { rushYd: 14, rushTD: 0, rec: 88, recYd: 1214, recTD: 6, fumLost: 0 }},
  { name: "Zay Flowers", position: "WR", team: "BAL", projectedStats: { rushYd: 60, rushTD: 0, rec: 80, recYd: 1174, recTD: 7, fumLost: 0 }},
  { name: "Justin Jefferson", position: "WR", team: "MIN", projectedStats: { rushYd: 12, rushTD: 0, rec: 109, recYd: 1372, recTD: 7, fumLost: 0 }},
  { name: "Tee Higgins", position: "WR", team: "CIN", projectedStats: { rushYd: 2, rushTD: 1, rec: 74, recYd: 953, recTD: 9, fumLost: 0 }},
  { name: "DeVonta Smith", position: "WR", team: "PHI", projectedStats: { rushYd: 0, rushTD: 1, rec: 91, recYd: 1126, recTD: 7, fumLost: 0 }},
  { name: "Malik Nabers", position: "WR", team: "NYG", projectedStats: { rushYd: 23, rushTD: 1, rec: 75, recYd: 1001, recTD: 6, fumLost: 0 }},
  { name: "Garrett Wilson", position: "WR", team: "NYJ", projectedStats: { rushYd: 9, rushTD: 0, rec: 105, recYd: 1215, recTD: 6, fumLost: 0 }},
  { name: "Emeka Egbuka", position: "WR", team: "TB", projectedStats: { rushYd: 14, rushTD: 1, rec: 69, recYd: 1076, recTD: 8, fumLost: 0 }},
  { name: "Terry McLaurin", position: "WR", team: "WAS", projectedStats: { rushYd: 1, rushTD: 0, rec: 80, recYd: 1041, recTD: 5, fumLost: 0 }},
  { name: "Alec Pierce", position: "WR", team: "IND", projectedStats: { rushYd: 0, rushTD: 1, rec: 67, recYd: 1023, recTD: 4, fumLost: 0 }},
  { name: "Courtland Sutton", position: "WR", team: "DEN", projectedStats: { rushYd: 0, rushTD: 0, rec: 70, recYd: 891, recTD: 8, fumLost: 0 }},
  { name: "Jameson Williams", position: "WR", team: "DET", projectedStats: { rushYd: 43, rushTD: 0, rec: 62, recYd: 1026, recTD: 6, fumLost: 0 }},
  { name: "Tetairoa McMillan", position: "WR", team: "CAR", projectedStats: { rushYd: 1, rushTD: 0, rec: 85, recYd: 1192, recTD: 7, fumLost: 0 }},
  { name: "Rome Odunze", position: "WR", team: "CHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 58, recYd: 1029, recTD: 8, fumLost: 0 }},
  { name: "Davante Adams", position: "WR", team: "LAR", projectedStats: { rushYd: 1, rushTD: 1, rec: 67, recYd: 1016, recTD: 10, fumLost: 0 }},
  { name: "Ladd McConkey", position: "WR", team: "LAC", projectedStats: { rushYd: 3, rushTD: 0, rec: 81, recYd: 1035, recTD: 5, fumLost: 0 }},
  { name: "Luther Burden III", position: "WR", team: "CHI", projectedStats: { rushYd: 49, rushTD: 1, rec: 77, recYd: 936, recTD: 6, fumLost: 0 }},
  { name: "Jaylen Waddle", position: "WR", team: "DEN", projectedStats: { rushYd: 11, rushTD: 1, rec: 76, recYd: 988, recTD: 7, fumLost: 0 }},
  { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", projectedStats: { rushYd: 2, rushTD: 1, rec: 70, recYd: 957, recTD: 6, fumLost: 0 }},
  { name: "DJ Moore", position: "WR", team: "BUF", projectedStats: { rushYd: 37, rushTD: 0, rec: 69, recYd: 944, recTD: 7, fumLost: 0 }},
  { name: "Mike Evans", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 56, recYd: 906, recTD: 7, fumLost: 0 }},
  { name: "Jakobi Meyers", position: "WR", team: "JAX", projectedStats: { rushYd: 29, rushTD: 0, rec: 71, recYd: 768, recTD: 5, fumLost: 0 }},
  { name: "Wan'Dale Robinson", position: "WR", team: "TEN", projectedStats: { rushYd: 19, rushTD: 0, rec: 78, recYd: 815, recTD: 3, fumLost: 0 }},
  { name: "DK Metcalf", position: "WR", team: "PIT", projectedStats: { rushYd: 0, rushTD: 1, rec: 66, recYd: 944, recTD: 5, fumLost: 0 }},
  { name: "Parker Washington", position: "WR", team: "JAX", projectedStats: { rushYd: 36, rushTD: 0, rec: 66, recYd: 847, recTD: 6, fumLost: 0 }},
  { name: "Chris Godwin", position: "WR", team: "TB", projectedStats: { rushYd: 0, rushTD: 0, rec: 59, recYd: 701, recTD: 5, fumLost: 0 }},
  { name: "Quentin Johnston", position: "WR", team: "LAC", projectedStats: { rushYd: 8, rushTD: 1, rec: 54, recYd: 770, recTD: 7, fumLost: 0 }},
  { name: "Josh Downs", position: "WR", team: "IND", projectedStats: { rushYd: 10, rushTD: 0, rec: 78, recYd: 721, recTD: 3, fumLost: 0 }},
  { name: "Christian Watson", position: "WR", team: "GB", projectedStats: { rushYd: 11, rushTD: 0, rec: 53, recYd: 871, recTD: 6, fumLost: 0 }},
  { name: "Michael Pittman", position: "WR", team: "PIT", projectedStats: { rushYd: 1, rushTD: 0, rec: 89, recYd: 863, recTD: 3, fumLost: 0 }},
  { name: "Michael Wilson", position: "WR", team: "ARI", projectedStats: { rushYd: 0, rushTD: 0, rec: 69, recYd: 815, recTD: 3, fumLost: 0 }},
  { name: "Brian Thomas Jr.", position: "WR", team: "JAX", projectedStats: { rushYd: 26, rushTD: 0, rec: 59, recYd: 861, recTD: 6, fumLost: 0 }},
  { name: "Khalil Shakir", position: "WR", team: "BUF", projectedStats: { rushYd: 11, rushTD: 1, rec: 68, recYd: 763, recTD: 5, fumLost: 0 }},
  { name: "Tank Dell", position: "WR", team: "HOU", projectedStats: { rushYd: 44, rushTD: 0, rec: 36, recYd: 465, recTD: 4, fumLost: 0 }},
  { name: "Jordan Addison", position: "WR", team: "MIN", projectedStats: { rushYd: 17, rushTD: 1, rec: 58, recYd: 772, recTD: 4, fumLost: 0 }},
  { name: "Jordyn Tyson", position: "WR", team: "NO", projectedStats: { rushYd: 0, rushTD: 0, rec: 65, recYd: 915, recTD: 6, fumLost: 0 }},
  { name: "Ricky Pearsall", position: "WR", team: "SF", projectedStats: { rushYd: 23, rushTD: 0, rec: 59, recYd: 811, recTD: 4, fumLost: 0 }},
  { name: "Jayden Reed", position: "WR", team: "GB", projectedStats: { rushYd: 66, rushTD: 0, rec: 62, recYd: 732, recTD: 5, fumLost: 0 }},
  { name: "Romeo Doubs", position: "WR", team: "NE", projectedStats: { rushYd: 1, rushTD: 0, rec: 62, recYd: 766, recTD: 7, fumLost: 0 }},
  { name: "John Metchie III", position: "WR", team: "CAR", projectedStats: { rushYd: 0, rec: 66, recYd: 596, recTD: 4 }},
  { name: "Jauan Jennings", position: "WR", team: "MIN", projectedStats: { rushYd: 1, rushTD: 0, rec: 48, recYd: 483, recTD: 3, fumLost: 0 }},
  { name: "Xavier Worthy", position: "WR", team: "KC", projectedStats: { rushYd: 74, rushTD: 1, rec: 56, recYd: 789, recTD: 4, fumLost: 0 }},
  { name: "Makai Lemon", position: "WR", team: "PHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 60, recYd: 881, recTD: 6, fumLost: 0 }},
  { name: "Cooper Kupp", position: "WR", team: "SEA", projectedStats: { rushYd: 0, rushTD: 1, rec: 39, recYd: 471, recTD: 4, fumLost: 0 }},
  { name: "Troy Franklin", position: "WR", team: "DEN", projectedStats: { rushYd: 11, rec: 58, recYd: 577, recTD: 5, fumLost: 1 }},
  { name: "Jalen Coker", position: "WR", team: "CAR", projectedStats: { rushYd: 0, rushTD: 1, rec: 60, recYd: 691, recTD: 2, fumLost: 0 }},
  { name: "Calvin Ridley", position: "WR", team: "TEN", projectedStats: { rushYd: 34, rushTD: 1, rec: 45, recYd: 720, recTD: 5, fumLost: 0 }},
  { name: "Carnell Tate", position: "WR", team: "TEN", projectedStats: { rushYd: 0, rushTD: 0, rec: 76, recYd: 1065, recTD: 5, fumLost: 0 }},
  { name: "Theo Wease Jr.", position: "WR", team: "MIA", projectedStats: { rushYd: 7, rec: 46, recYd: 682, recTD: 6, fumLost: 1 }},
  { name: "Jerry Jeudy", position: "WR", team: "CLE", projectedStats: { rushYd: 0, rushTD: 1, rec: 52, recYd: 709, recTD: 2, fumLost: 0 }},
  { name: "Travis Hunter", position: "WR", team: "JAX", projectedStats: { rushYd: 11, rec: 71, recYd: 871, recTD: 6, fumLost: 1 }},
  { name: "Keon Coleman", position: "WR", team: "BUF", projectedStats: { rushYd: 0, rushTD: 0, rec: 18, recYd: 267, recTD: 1, fumLost: 0 }},
  { name: "Deebo Samuel", position: "WR", team: "FA", projectedStats: { rushYd: 0, rushTD: 0, rec: 1, recYd: 0, recTD: 0, fumLost: 0 }},
  { name: "Marvin Mims Jr.", position: "WR", team: "DEN", projectedStats: { rushYd: 32, rushTD: 2, rec: 57, recYd: 759, recTD: 4, fumLost: 1 }},
  { name: "Rashod Bateman", position: "WR", team: "BAL", projectedStats: { rushYd: 0, rushTD: 0, rec: 40, recYd: 618, recTD: 4, fumLost: 0 }},
  { name: "Tre Tucker", position: "WR", team: "LV", projectedStats: { rushYd: 57, rushTD: 0, rec: 49, recYd: 655, recTD: 2, fumLost: 0 }},
  { name: "Rashid Shaheed", position: "WR", team: "SEA", projectedStats: { rushYd: 85, rushTD: 1, rec: 41, recYd: 643, recTD: 4, fumLost: 0 }},
  { name: "Christian Kirk", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 24, recYd: 319, recTD: 2, fumLost: 0 }},
  { name: "Jalen Nailor", position: "WR", team: "LV", projectedStats: { rushYd: 9, rushTD: 1, rec: 40, recYd: 560, recTD: 2, fumLost: 0 }},
  { name: "Jayden Higgins", position: "WR", team: "HOU", projectedStats: { rushYd: 2, rushTD: 1, rec: 53, recYd: 665, recTD: 4, fumLost: 0 }},
  { name: "Omar Cooper Jr.", position: "WR", team: "NYJ", projectedStats: { rushYd: 11, rushTD: 0, rec: 41, recYd: 480, recTD: 4, fumLost: 0 }},
  { name: "Antonio Williams", position: "WR", team: "WAS", projectedStats: { rushYd: 20, rushTD: 0, rec: 43, recYd: 520, recTD: 4, fumLost: 0 }},
  { name: "Kayshon Boutte", position: "WR", team: "NE", projectedStats: { rec: 39, recYd: 604, recTD: 5 }},
  { name: "Jalen McMillan", position: "WR", team: "TB", projectedStats: { rushYd: 26, rushTD: 0, rec: 49, recYd: 588, recTD: 4, fumLost: 0 }},
  { name: "Marquise Brown", position: "WR", team: "PHI", projectedStats: { rec: 42, recYd: 547, recTD: 4 }},
  { name: "Devaughn Vele", position: "WR", team: "NO", projectedStats: { rec: 46, recYd: 583, recTD: 5 }},
  { name: "Matthew Golden", position: "WR", team: "GB", projectedStats: { rushYd: 23, rushTD: 1, rec: 68, recYd: 872, recTD: 4, fumLost: 0 }},
  { name: "Elic Ayomanor", position: "WR", team: "TEN", projectedStats: { rec: 39, recYd: 538, recTD: 4 }},
  { name: "KC Concepcion", position: "WR", team: "CLE", projectedStats: { rushYd: 34, rushTD: 1, rec: 59, recYd: 771, recTD: 4, fumLost: 0 }},
  { name: "Tory Horton", position: "WR", team: "SEA", projectedStats: { rushYd: 7, rec: 39, recYd: 508, recTD: 7, fumLost: 1 }},
  { name: "Darnell Mooney", position: "WR", team: "NYG", projectedStats: { rushYd: 10, rushTD: 0, rec: 31, recYd: 467, recTD: 4, fumLost: 0 }},
  { name: "Chimere Dike", position: "WR", team: "TEN", projectedStats: { rushYd: 22, rec: 42, recYd: 404, recTD: 7, fumLost: 1 }},
  { name: "De'Zhaun Stribling", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 19, recYd: 299, recTD: 1, fumLost: 0 }},
  { name: "Denzel Boston", position: "WR", team: "CLE", projectedStats: { rushYd: 3, rushTD: 0, rec: 51, recYd: 640, recTD: 3, fumLost: 0 }},
  { name: "Darius Slayton", position: "WR", team: "NYG", projectedStats: { rushYd: 1, rec: 39, recYd: 611, recTD: 1, fumLost: 1 }},
  { name: "Ja'Kobi Lane", position: "WR", team: "BAL", projectedStats: { rushYd: 16, rec: 33, recYd: 526, recTD: 5, fumLost: 1 }},
  { name: "Germie Bernard", position: "WR", team: "PIT", projectedStats: { rushYd: 10, rushTD: 0, rec: 49, recYd: 591, recTD: 2, fumLost: 0 }},
  { name: "Tyquan Thornton", position: "WR", team: "KC", projectedStats: { rec: 28, recYd: 573, recTD: 3 }},
  { name: "Bub Means", position: "WR", team: "NO", projectedStats: { rushYd: 11, rec: 36, recYd: 520, recTD: 2, fumLost: 1 }},
  { name: "Malik Washington", position: "WR", team: "MIA", projectedStats: { rushYd: 74, rushTD: 1, rec: 42, recYd: 434, recTD: 1, fumLost: 0 }},
  { name: "Olamide Zaccheaus", position: "WR", team: "ATL", projectedStats: { rushYd: 15, rec: 47, recYd: 413, recTD: 2 }},
  { name: "Jahdae Walker", position: "WR", team: "CHI", projectedStats: { rushYd: 4, rec: 30, recYd: 414, recTD: 4 }},
  { name: "Calvin Austin III", position: "WR", team: "NYG", projectedStats: { rec: 31, recYd: 444, recTD: 4 }},
  { name: "Andrei Iosivas", position: "WR", team: "CIN", projectedStats: { rushYd: 15, rec: 34, recYd: 477, recTD: 4 }},
  { name: "Cedric Tillman", position: "WR", team: "CLE", projectedStats: { rushYd: 0, rec: 32, recYd: 413, recTD: 5 }},
  { name: "Ted Hurst", position: "WR", team: "TB", projectedStats: { rushYd: 17, rec: 37, recYd: 487, recTD: 2, fumLost: 1 }},
  { name: "Isaac TeSlaa", position: "WR", team: "DET", projectedStats: { rushYd: 1, rushTD: 0, rec: 23, recYd: 305, recTD: 2, fumLost: 0 }},
  { name: "Ashton Dulin", position: "WR", team: "IND", projectedStats: { rushYd: 66, rec: 30, recYd: 557, recTD: 3 }},
  { name: "Dontayvion Wicks", position: "WR", team: "PHI", projectedStats: { rushYd: 8, rec: 36, recYd: 394, recTD: 2 }},
  { name: "Demarcus Robinson", position: "WR", team: "SF", projectedStats: { rushYd: 2, rec: 30, recYd: 466, recTD: 4 }},
  { name: "Xavier Hutchinson", position: "WR", team: "HOU", projectedStats: { rushYd: 16, rec: 33, recYd: 409, recTD: 4 }},
  { name: "Caleb Douglas", position: "WR", team: "MIA", projectedStats: { rushYd: 3, rushTD: 1, rec: 33, recYd: 446, recTD: 1, fumLost: 0 }},
  { name: "Josh Palmer", position: "WR", team: "BUF", projectedStats: { rec: 36, recYd: 464, recTD: 1 }},
  { name: "Zavion Thomas", position: "WR", team: "CHI", projectedStats: { rushYd: 12, rec: 35, recYd: 436, recTD: 3, fumLost: 2 }},
  { name: "Zachariah Branch", position: "WR", team: "ATL", projectedStats: { rushYd: 16, rec: 36, recYd: 504, recTD: 2, fumLost: 3 }},
  { name: "Luke McCaffrey", position: "WR", team: "WAS", projectedStats: { rec: 23, recYd: 381, recTD: 4 }},
  { name: "Kevin Austin Jr.", position: "WR", team: "NO", projectedStats: { rushYd: 6, rec: 35, recYd: 391, recTD: 1 }},
  { name: "Kendrick Bourne", position: "WR", team: "ARI", projectedStats: { rushYd: 5, rec: 34, recYd: 421, recTD: 3 }},
  { name: "Jalen Tolbert", position: "WR", team: "MIA", projectedStats: { rushYd: 3, rushTD: 1, rec: 25, recYd: 327, recTD: 2, fumLost: 0 }},
  { name: "Tez Johnson", position: "WR", team: "TB", projectedStats: { rushYd: 28, rec: 27, recYd: 307, recTD: 3 }},
  { name: "Ben Skowronek", position: "WR", team: "PIT", projectedStats: { rec: 22, recYd: 374, recTD: 2 }},
  { name: "Ryan Flournoy", position: "WR", team: "DAL", projectedStats: { rushYd: 11, rushTD: 0, rec: 32, recYd: 383, recTD: 3, fumLost: 0 }},
  { name: "Roman Wilson", position: "WR", team: "PIT", projectedStats: { rushYd: 0, rec: 27, recYd: 374, recTD: 4, fumLost: 3 }},
  { name: "Mack Hollins", position: "WR", team: "NE", projectedStats: { rushYd: 0, rec: 27, recYd: 370, recTD: 1 }},
  { name: "Adonai Mitchell", position: "WR", team: "NYJ", projectedStats: { rushYd: 14, rushTD: 0, rec: 37, recYd: 562, recTD: 4, fumLost: 0 }},
  { name: "Devontez Walker", position: "WR", team: "BAL", projectedStats: { rushYd: 1, rec: 22, recYd: 382, recTD: 4 }},
  // ── TE (CBS/SportsLine 2026, adjusted) ──
  { name: "Trey McBride", position: "TE", team: "ARI", projectedStats: { rushYd: 2, rushTD: 0, rec: 110, recYd: 1066, recTD: 5, fumLost: 0 }},
  { name: "Brock Bowers", position: "TE", team: "LV", projectedStats: { rushYd: 14, rushTD: 0, rec: 99, recYd: 998, recTD: 7, fumLost: 0 }},
  { name: "Colston Loveland", position: "TE", team: "CHI", projectedStats: { rushYd: 0, rushTD: 0, rec: 82, recYd: 895, recTD: 6, fumLost: 0 }},
  { name: "Tyler Warren", position: "TE", team: "IND", projectedStats: { rushYd: 17, rushTD: 0, rec: 86, recYd: 867, recTD: 5, fumLost: 0 }},
  { name: "Kyle Pitts", position: "TE", team: "ATL", projectedStats: { rushYd: 0, rushTD: 1, rec: 81, recYd: 859, recTD: 4, fumLost: 0 }},
  { name: "Dallas Goedert", position: "TE", team: "PHI", projectedStats: { rushYd: 3, rushTD: 0, rec: 68, recYd: 725, recTD: 7, fumLost: 0 }},
  { name: "Harold Fannin Jr.", position: "TE", team: "CLE", projectedStats: { rushYd: 22, rushTD: 1, rec: 81, recYd: 821, recTD: 2, fumLost: 0 }},
  { name: "Sam LaPorta", position: "TE", team: "DET", projectedStats: { rushYd: 0, rushTD: 1, rec: 76, recYd: 785, recTD: 6, fumLost: 0 }},
  { name: "George Kittle", position: "TE", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 75, recYd: 813, recTD: 6, fumLost: 0 }},
  { name: "Isaiah Likely", position: "TE", team: "NYG", projectedStats: { rushYd: 1, rushTD: 0, rec: 66, recYd: 683, recTD: 4, fumLost: 0 }},
  { name: "Tucker Kraft", position: "TE", team: "GB", projectedStats: { rushYd: 9, rushTD: 1, rec: 66, recYd: 729, recTD: 5, fumLost: 0 }},
  { name: "Travis Kelce", position: "TE", team: "KC", projectedStats: { rushYd: 0, rushTD: 0, rec: 76, recYd: 767, recTD: 4, fumLost: 0 }},
  { name: "Brenton Strange", position: "TE", team: "JAX", projectedStats: { rushYd: 2, rushTD: 0, rec: 61, recYd: 600, recTD: 3, fumLost: 0 }},
  { name: "Jake Ferguson", position: "TE", team: "DAL", projectedStats: { rushYd: 0, rushTD: 0, rec: 74, recYd: 603, recTD: 5, fumLost: 0 }},
  { name: "Dalton Kincaid", position: "TE", team: "BUF", projectedStats: { rushYd: 2, rushTD: 0, rec: 58, recYd: 699, recTD: 3, fumLost: 0 }},
  { name: "Juwan Johnson", position: "TE", team: "NO", projectedStats: { rushYd: 0, rushTD: 0, rec: 62, recYd: 639, recTD: 3, fumLost: 0 }},
  { name: "Mark Andrews", position: "TE", team: "BAL", projectedStats: { rushYd: 32, rushTD: 1, rec: 60, recYd: 616, recTD: 8, fumLost: 0 }},
  { name: "Hunter Henry", position: "TE", team: "NE", projectedStats: { rushYd: 0, rushTD: 0, rec: 57, recYd: 631, recTD: 5, fumLost: 0 }},
  { name: "Dalton Schultz", position: "TE", team: "HOU", projectedStats: { rushYd: 0, rushTD: 0, rec: 58, recYd: 553, recTD: 3, fumLost: 0 }},
  { name: "Cade Otton", position: "TE", team: "TB", projectedStats: { rec: 65, recYd: 710, recTD: 4 }},
  { name: "Greg Dulcich", position: "TE", team: "MIA", projectedStats: { rushYd: 0, rec: 59, recYd: 670, recTD: 4, fumLost: 2 }},
  { name: "AJ Barner", position: "TE", team: "SEA", projectedStats: { rushYd: 13, rushTD: 2, rec: 48, recYd: 476, recTD: 6 }},
  { name: "Kenyon Sadiq", position: "TE", team: "NYJ", projectedStats: { rushYd: 2, rushTD: 0, rec: 68, recYd: 691, recTD: 5, fumLost: 0 }},
  { name: "Oronde Gadsden II", position: "TE", team: "LAC", projectedStats: { rushYd: 0, rushTD: 1, rec: 44, recYd: 482, recTD: 3, fumLost: 0 }},
  { name: "T.J. Hockenson", position: "TE", team: "MIN", projectedStats: { rushYd: 3, rushTD: 0, rec: 77, recYd: 638, recTD: 3, fumLost: 0 }},
  { name: "Pat Freiermuth", position: "TE", team: "PIT", projectedStats: { rushYd: 1, rushTD: 0, rec: 61, recYd: 599, recTD: 3, fumLost: 0 }},
  { name: "Chigoziem Okonkwo", position: "TE", team: "WAS", projectedStats: { rushYd: 0, rushTD: 0, rec: 56, recYd: 552, recTD: 2, fumLost: 0 }},
  { name: "Colby Parkinson", position: "TE", team: "LAR", projectedStats: { rec: 44, recYd: 479, recTD: 7, fumLost: 1 }},
  { name: "Mason Taylor", position: "TE", team: "NYJ", projectedStats: { rec: 58, recYd: 465, recTD: 3 }},
  { name: "Mike Gesicki", position: "TE", team: "CIN", projectedStats: { rec: 51, recYd: 542, recTD: 3 }},
  { name: "Evan Engram", position: "TE", team: "DEN", projectedStats: { rushYd: 11, rec: 57, recYd: 468, recTD: 3 }},
  { name: "David Njoku", position: "TE", team: "LAC", projectedStats: { rec: 41, recYd: 405, recTD: 7 }},
  { name: "Tyler Higbee", position: "TE", team: "LAR", projectedStats: { rec: 42, recYd: 504, recTD: 5 }},
  { name: "Theo Johnson", position: "TE", team: "NYG", projectedStats: { rec: 35, recYd: 384, recTD: 4 }},
  { name: "Terrance Ferguson", position: "TE", team: "LAR", projectedStats: { rushYd: 2, rushTD: 0, rec: 41, recYd: 537, recTD: 5, fumLost: 0 }},
  { name: "Gunnar Helm", position: "TE", team: "TEN", projectedStats: { rushYd: 0, rushTD: 1, rec: 60, recYd: 497, recTD: 2, fumLost: 0 }},
  { name: "Dawson Knox", position: "TE", team: "BUF", projectedStats: { rec: 37, recYd: 398, recTD: 2 }},
  { name: "Noah Fant", position: "TE", team: "NO", projectedStats: { rec: 42, recYd: 421, recTD: 3, fumLost: 3 }},
  { name: "Michael Mayer", position: "TE", team: "LV", projectedStats: { rec: 38, recYd: 347, recTD: 1 }},
  { name: "Will Kacmarek", position: "TE", team: "MIA", projectedStats: { rec: 33, recYd: 327, recTD: 2, fumLost: 1 }},
  { name: "Darnell Washington", position: "TE", team: "PIT", projectedStats: { rec: 37, recYd: 383, recTD: 3, fumLost: 1 }},
  { name: "Brock Wright", position: "TE", team: "DET", projectedStats: { rec: 30, recYd: 280, recTD: 5 }},
  { name: "Charlie Kolar", position: "TE", team: "LAC", projectedStats: { rushYd: 3, rec: 24, recYd: 334, recTD: 5 }},
  { name: "Marlin Klein", position: "TE", team: "HOU", projectedStats: { rec: 33, recYd: 355, recTD: 3, fumLost: 1 }},
  { name: "Erick All", position: "TE", team: "CIN", projectedStats: { rec: 34, recYd: 305, recTD: 2 }},
  { name: "Daniel Bellinger", position: "TE", team: "TEN", projectedStats: { rec: 24, recYd: 315, recTD: 2 }},
  { name: "Ben Sims", position: "TE", team: "MIA", projectedStats: { rec: 33, recYd: 307, recTD: 1 }},
  { name: "Eli Stowers", position: "TE", team: "PHI", projectedStats: { rec: 29, recYd: 317, recTD: 3, fumLost: 1 }},
  { name: "Josh Oliver", position: "TE", team: "MIN", projectedStats: { rec: 24, recYd: 245, recTD: 4 }},
  { name: "Davis Allen", position: "TE", team: "LAR", projectedStats: { rec: 24, recYd: 236, recTD: 4 }},
  { name: "Tommy Tremble", position: "TE", team: "CAR", projectedStats: { rec: 28, recYd: 267, recTD: 3 }},
  { name: "Adam Trautman", position: "TE", team: "DEN", projectedStats: { rec: 29, recYd: 279, recTD: 2 }},
  { name: "Ja'Tavion Sanders", position: "TE", team: "CAR", projectedStats: { rec: 28, recYd: 236, recTD: 1 }},
  { name: "Luke Musgrave", position: "TE", team: "GB", projectedStats: { rec: 24, recYd: 258, recTD: 1 }},
  { name: "Austin Hooper", position: "TE", team: "ATL", projectedStats: { rec: 24, recYd: 287, recTD: 1 }},
  { name: "Jeremy Ruckert", position: "TE", team: "NYJ", projectedStats: { rec: 28, recYd: 192, recTD: 2 }},
  { name: "Grant Calcaterra", position: "TE", team: "PHI", projectedStats: { rec: 21, recYd: 224, recTD: 1 }},
  { name: "Cole Kmet", position: "TE", team: "CHI", projectedStats: { rushYd: 0, rec: 19, recYd: 219, recTD: 3 }},
  { name: "Eli Raridon", position: "TE", team: "NE", projectedStats: { rec: 24, recYd: 240, recTD: 3, fumLost: 1 }},
  { name: "Nate Boerkircher", position: "TE", team: "JAX", projectedStats: { rec: 22, recYd: 236, recTD: 1, fumLost: 1 }},
  { name: "John Bates", position: "TE", team: "WAS", projectedStats: { rec: 21, recYd: 217, recTD: 2, fumLost: 1 }},
  { name: "Matthew Hibner", position: "TE", team: "BAL", projectedStats: { rec: 18, recYd: 191, recTD: 3 }},
  { name: "Elijah Higgins", position: "TE", team: "ARI", projectedStats: { rec: 21, recYd: 210, recTD: 1, fumLost: 1 }},
  { name: "Nate Adkins", position: "TE", team: "DEN", projectedStats: { rec: 14, recYd: 112, recTD: 4 }},
  // ── K (CBS/SportsLine 2026, adjusted) ──
  { name: "Harrison Mevis", position: "K", team: "LAR", projectedStats: { fgMade: 30, fgMissed: 4, xpMade: 55, xpMissed: 1 }},
  { name: "Jake Bates", position: "K", team: "DET", projectedStats: { fgMade: 28, fgMissed: 4, xpMade: 49, xpMissed: 2 }},
  { name: "Jason Myers", position: "K", team: "SEA", projectedStats: { fgMade: 33, fgMissed: 5, xpMade: 43, xpMissed: 0 }},
  { name: "Spencer Shrader", position: "K", team: "IND", projectedStats: { fgMade: 34, fgMissed: 5, xpMade: 51, xpMissed: 2 }},
  { name: "Brandon Aubrey", position: "K", team: "DAL", projectedStats: { fgMade: 35, fgMissed: 5, xpMade: 46, xpMissed: 1 }},
  { name: "Nick Folk", position: "K", team: "ATL", projectedStats: { fgMade: 35, fgMissed: 3, xpMade: 47, xpMissed: 0 }},
  { name: "Cam Little", position: "K", team: "JAX", projectedStats: { fgMade: 30, fgMissed: 4, xpMade: 40, xpMissed: 1 }},
  { name: "Tyler Loop", position: "K", team: "BAL", projectedStats: { fgMade: 29, fgMissed: 5, xpMade: 44, xpMissed: 2 }},
  { name: "Cairo Santos", position: "K", team: "CHI", projectedStats: { fgMade: 30, fgMissed: 4, xpMade: 40, xpMissed: 1 }},
  { name: "Evan McPherson ", position: "K", team: "CIN", projectedStats: { fgMade: 30, fgMissed: 4, xpMade: 47, xpMissed: 3 }},
  { name: "Wil Lutz", position: "K", team: "DEN", projectedStats: { fgMade: 30, fgMissed: 6, xpMade: 44, xpMissed: 1 }},
  { name: "Tyler Bass", position: "K", team: "BUF", projectedStats: { fgMade: 26, fgMissed: 5, xpMade: 46, xpMissed: 3 }},
  { name: "Andres Borregales", position: "K", team: "NE", projectedStats: { fgMade: 27, fgMissed: 5, xpMade: 44, xpMissed: 1 }},
  { name: "Will Reichard", position: "K", team: "MIN", projectedStats: { fgMade: 31, fgMissed: 4, xpMade: 34, xpMissed: 1 }},
  { name: "Jake Moody", position: "K", team: "WAS", projectedStats: { fgMade: 28, fgMissed: 6, xpMade: 43, xpMissed: 2 }},
  { name: "Chase McLaughlin", position: "K", team: "TB", projectedStats: { fgMade: 31, fgMissed: 3, xpMade: 35, xpMissed: 0 }},
  { name: "Jake Elliott", position: "K", team: "PHI", projectedStats: { fgMade: 26, fgMissed: 7, xpMade: 41, xpMissed: 2 }},
  { name: "Ka'imi Fairbairn", position: "K", team: "HOU", projectedStats: { fgMade: 36, fgMissed: 4, xpMade: 31, xpMissed: 1 }},
  { name: "Cameron Dicker", position: "K", team: "LAC", projectedStats: { fgMade: 34, fgMissed: 4, xpMade: 41, xpMissed: 1 }},
  { name: "Charlie Smyth", position: "K", team: "NO", projectedStats: { fgMade: 30, fgMissed: 6, xpMade: 37, xpMissed: 1 }},
  { name: "Chad Ryland", position: "K", team: "ARI", projectedStats: { fgMade: 26, fgMissed: 7, xpMade: 37, xpMissed: 1 }},
  { name: "Chris Boswell", position: "K", team: "PIT", projectedStats: { fgMade: 31, fgMissed: 4, xpMade: 32, xpMissed: 0 }},
  { name: "Zane Gonzalez", position: "K", team: "MIA", projectedStats: { fgMade: 27, fgMissed: 4, xpMade: 37, xpMissed: 2 }},
  { name: "Trey Smack", position: "K", team: "GB", projectedStats: { fgMade: 28, fgMissed: 6, xpMade: 38, xpMissed: 5 }},
  { name: "Eddy Pineiro", position: "K", team: "SF", projectedStats: { fgMade: 32, fgMissed: 4, xpMade: 42, xpMissed: 1 }},
  { name: "Matt Gay", position: "K", team: "LV", projectedStats: { fgMade: 23, fgMissed: 8, xpMade: 33, xpMissed: 1 }},
  { name: "Jason Sanders", position: "K", team: "NYJ", projectedStats: { fgMade: 29, fgMissed: 5, xpMade: 35, xpMissed: 3 }},
  { name: "Harrison Butker", position: "K", team: "KC", projectedStats: { fgMade: 31, fgMissed: 5, xpMade: 41, xpMissed: 1 }},
  { name: "Joey Slye", position: "K", team: "TEN", projectedStats: { fgMade: 28, fgMissed: 5, xpMade: 32, xpMissed: 2 }},
  { name: "Ryan Fitzgerald", position: "K", team: "CAR", projectedStats: { fgMade: 22, fgMissed: 5, xpMade: 30, xpMissed: 3 }},
  // ── DEF (CBS/SportsLine 2026, adjusted) ──
  { name: "Houston Texans", position: "DEF", team: "HOU", projectedStats: { sacks: 42, fumRec: 11, ints: 12, defTD: 2, safety: 0, ptsAllowed: 322 }},
  { name: "Denver Broncos", position: "DEF", team: "DEN", projectedStats: { sacks: 45, fumRec: 7, ints: 13, defTD: 2, safety: 0, ptsAllowed: 318 }},
  { name: "Seattle Seahawks", position: "DEF", team: "SEA", projectedStats: { sacks: 42, fumRec: 7, ints: 13, defTD: 3, safety: 0, ptsAllowed: 331 }},
  { name: "Los Angeles Rams", position: "DEF", team: "LAR", projectedStats: { sacks: 44, fumRec: 8, ints: 12, defTD: 2, safety: 0, ptsAllowed: 332 }},
  { name: "Minnesota Vikings", position: "DEF", team: "MIN", projectedStats: { sacks: 38, fumRec: 9, ints: 11, defTD: 2, safety: 0, ptsAllowed: 380 }},
  { name: "Philadelphia Eagles", position: "DEF", team: "PHI", projectedStats: { sacks: 39, fumRec: 7, ints: 12, defTD: 2, safety: 0, ptsAllowed: 333 }},
  { name: "Detroit Lions", position: "DEF", team: "DET", projectedStats: { sacks: 39, fumRec: 9, ints: 13, defTD: 2, safety: 0, ptsAllowed: 336 }},
  { name: "Pittsburgh Steelers", position: "DEF", team: "PIT", projectedStats: { sacks: 44, fumRec: 10, ints: 12, defTD: 2, safety: 0, ptsAllowed: 319 }},
  { name: "Los Angeles Chargers", position: "DEF", team: "LAC", projectedStats: { sacks: 40, fumRec: 8, ints: 13, defTD: 2, safety: 0, ptsAllowed: 371 }},
  { name: "Buffalo Bills", position: "DEF", team: "BUF", projectedStats: { sacks: 46, ints: 16, fumRec: 11, defTD: 3, safety: 0, ptsAllowed: 396 }},
  { name: "Baltimore Ravens", position: "DEF", team: "BAL", projectedStats: { sacks: 44, fumRec: 8, ints: 12, defTD: 2, safety: 0, ptsAllowed: 330 }},
  { name: "Chicago Bears", position: "DEF", team: "CHI", projectedStats: { sacks: 44, ints: 16, fumRec: 13, defTD: 3, safety: 0, ptsAllowed: 393 }},
  { name: "Atlanta Falcons", position: "DEF", team: "ATL", projectedStats: { sacks: 66, ints: 15, fumRec: 10, defTD: 3, safety: 0, ptsAllowed: 416 }},
  { name: "New England Patriots", position: "DEF", team: "NE", projectedStats: { sacks: 41, fumRec: 6, ints: 13, defTD: 2, safety: 0, ptsAllowed: 353 }},
  { name: "Indianapolis Colts", position: "DEF", team: "IND", projectedStats: { sacks: 40, ints: 13, fumRec: 11, defTD: 3, safety: 0, ptsAllowed: 401 }},
  { name: "New Orleans Saints", position: "DEF", team: "NO", projectedStats: { sacks: 54, ints: 14, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 431 }},
  { name: "Green Bay Packers", position: "DEF", team: "GB", projectedStats: { sacks: 41, fumRec: 7, ints: 12, defTD: 2, safety: 0, ptsAllowed: 369 }},
  { name: "Kansas City Chiefs", position: "DEF", team: "KC", projectedStats: { sacks: 41, fumRec: 7, ints: 12, defTD: 2, safety: 0, ptsAllowed: 359 }},
  { name: "Jacksonville Jaguars", position: "DEF", team: "JAX", projectedStats: { sacks: 41, fumRec: 7, ints: 13, defTD: 2, safety: 0, ptsAllowed: 388 }},
  { name: "Cleveland Browns", position: "DEF", team: "CLE", projectedStats: { sacks: 41, fumRec: 7, ints: 11, defTD: 2, safety: 0, ptsAllowed: 341 }},
  { name: "Cincinnati Bengals", position: "DEF", team: "CIN", projectedStats: { sacks: 47, ints: 13, fumRec: 13, defTD: 3, safety: 0, ptsAllowed: 447 }},
  { name: "Miami Dolphins", position: "DEF", team: "MIA", projectedStats: { sacks: 52, ints: 10, fumRec: 13, defTD: 3, safety: 0, ptsAllowed: 474 }},
  { name: "Las Vegas Raiders", position: "DEF", team: "LV", projectedStats: { sacks: 46, ints: 11, fumRec: 13, defTD: 2, safety: 0, ptsAllowed: 474 }},
  { name: "Tampa Bay Buccaneers", position: "DEF", team: "TB", projectedStats: { sacks: 42, fumRec: 5, ints: 12, defTD: 2, safety: 0, ptsAllowed: 363 }},
  { name: "Washington Commanders", position: "DEF", team: "WAS", projectedStats: { sacks: 48, ints: 11, fumRec: 9, defTD: 3, safety: 0, ptsAllowed: 455 }},
  { name: "New York Giants", position: "DEF", team: "NYG", projectedStats: { sacks: 40, ints: 11, fumRec: 11, defTD: 3, safety: 0, ptsAllowed: 468 }},
  { name: "Carolina Panthers", position: "DEF", team: "CAR", projectedStats: { sacks: 43, ints: 13, fumRec: 9, defTD: 2, safety: 0, ptsAllowed: 421 }},
  { name: "Tennessee Titans", position: "DEF", team: "TEN", projectedStats: { sacks: 53, ints: 10, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 520 }},
  { name: "San Francisco 49ers", position: "DEF", team: "SF", projectedStats: { sacks: 33, ints: 11, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 409 }},
  { name: "Dallas Cowboys", position: "DEF", team: "DAL", projectedStats: { sacks: 44, ints: 9, fumRec: 11, defTD: 2, safety: 0, ptsAllowed: 497 }},
  { name: "Arizona Cardinals", position: "DEF", team: "ARI", projectedStats: { sacks: 35, ints: 12, fumRec: 12, defTD: 2, safety: 0, ptsAllowed: 520 }},
  { name: "New York Jets", position: "DEF", team: "NYJ", projectedStats: { sacks: 35, ints: 12, fumRec: 8, defTD: 3, safety: 0, ptsAllowed: 492 }},

  { name: "Alvin Kamara", position: "RB", team: "NO", projectedStats: { rushYd: 479, rushTD: 2, rec: 34, recYd: 230, recTD: 1, fumLost: 0 }},
  { name: "Chris Bell", position: "WR", team: "MIA", projectedStats: { rushYd: 0, rushTD: 0, rec: 41, recYd: 533, recTD: 3, fumLost: 0 }},
  { name: "Stefon Diggs", position: "WR", team: "FA", projectedStats: { rushYd: 3, rushTD: 0, rec: 0, recYd: 3, recTD: 0, fumLost: 0 }},
  { name: "Jack Bech", position: "WR", team: "LV", projectedStats: { rushYd: 0, rushTD: 1, rec: 43, recYd: 486, recTD: 3, fumLost: 0 }},
  { name: "Brandon Aiyuk", position: "WR", team: "SF", projectedStats: { rushYd: 0, rushTD: 0, rec: 1, recYd: 3, recTD: 0, fumLost: 0 }},
  { name: "Tre' Harris", position: "WR", team: "LAC", projectedStats: { rushYd: 0, rushTD: 0, rec: 34, recYd: 405, recTD: 2, fumLost: 0 }},
  { name: "Tyreek Hill", position: "WR", team: "FA", projectedStats: { rushYd: 0, rushTD: 0, rec: 0, recYd: 0, recTD: 0, fumLost: 0 }},
  { name: "Savion Williams", position: "WR", team: "GB", projectedStats: { rushYd: 45, rushTD: 0, rec: 26, recYd: 275, recTD: 2, fumLost: 0 }},
  { name: "Chris Brazzell II", position: "WR", team: "CAR", projectedStats: { rushYd: 0, rushTD: 0, rec: 21, recYd: 289, recTD: 3, fumLost: 0 }},
  { name: "Xavier Legette", position: "WR", team: "CAR", projectedStats: { rushYd: 14, rushTD: 0, rec: 25, recYd: 311, recTD: 2, fumLost: 0 }},
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/projections') {
      if (request.method !== 'GET') return new Response('method', { status: 405 });
      if (request.headers.get('x-it-key') !== IT_KEY) return new Response('forbidden', { status: 403 });
      const ref = request.headers.get('Referer') || '';
      if (ref && !/^https?:\/\/(www\.)?irontuna\.com|^https?:\/\/localhost|\.pages\.dev/.test(ref)) return new Response('forbidden', { status: 403 });
      return new Response(_xb64encode(JSON.stringify(PROJECTIONS), PROJ_KEY), { headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, max-age=300' } });
    }
    if (url.pathname === '/api/live') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      try {
        const cache = caches.default;
        const key = new Request(url.origin + '/api/live?v=2');
        const hit = await cache.match(key);
        if (hit) { const r = new Response(hit.body, hit); for (const [k, v] of Object.entries(c)) r.headers.set(k, v); return r; }
        const up = await fetch('https://api.sleeper.app/v1/players/nfl', { cf: { cacheTtl: 21600, cacheEverything: true } });
        if (!up.ok) return json({ updated: Date.now(), players: {} }, 200, c);
        const all = await up.json();
        const FANT = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
        const out = {};
        for (const id in all) {
          const p = all[id];
          if (!p || !FANT.has(p.position)) continue;
          const name = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
          if (!name) continue;
          const REAL = new Set(['Questionable', 'Doubtful', 'Out', 'IR', 'PUP', 'Sus', 'Suspended', 'COV', 'NFI', 'DNR']);
          const injRaw = p.injury_status || null;
          const inj = (injRaw && REAL.has(injRaw)) ? injRaw : null;
          const team = p.team || null;
          if (!inj && !team) continue;
          out[name] = { t: team, i: inj, s: p.status || null };
        }
        const body = JSON.stringify({ updated: Date.now(), players: out });
        const store = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } });
        await cache.put(key, store.clone());
        const r = new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' } });
        for (const [k, v] of Object.entries(c)) r.headers.set(k, v);
        return r;
      } catch (e) { return json({ updated: Date.now(), players: {}, error: String(e) }, 200, c); }
    }
    if (url.pathname === '/api/lead') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ ok: false }, 405, c);
      let body = {}; try { body = await request.json(); } catch (e) {}
      const email = (body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'invalid' }, 400, c);
      if (env.LEAD_WEBHOOK) {
        try { await fetch(env.LEAD_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, source: body.source || 'cheatsheet', scoring: body.scoring || null, ts: Date.now() }) }); } catch (e) {}
      }
      return json({ ok: true, stored: !!env.LEAD_WEBHOOK }, 200, c);
    }
    if (url.pathname === '/api/track') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return new Response(null, { status: 204, headers: c });
      if (env.ANALYTICS_WEBHOOK) { try { const b = await request.text(); await fetch(env.ANALYTICS_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json' }, body: b }); } catch (e) {} }
      return new Response(null, { status: 204, headers: c });
    }
    if (url.pathname === '/api/coach') {
      const c = corsHeaders(request.headers.get('Origin'));
      if (request.method === 'OPTIONS') return new Response(null, { headers: c });
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, c);
      return handleCoach(request, env, c);
    }
    // Serve static assets, but tell browsers to revalidate HTML every load so
    // updates show up without a hard refresh (the app is a single index.html).
    const resp = await env.ASSETS.fetch(request);
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      const r = new Response(resp.body, resp);
      r.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
      return r;
    }
    return resp;
  },
};

function originAllowed(request, env) {
  const allow = (env.ALLOWED_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!allow.length) return true;
  const o = request.headers.get('Origin');
  return o && allow.includes(o);
}

async function handleCoach(request, env, c) {
  if (!originAllowed(request, env)) return json({ error: 'Origin not allowed' }, 403, c);
  if (!env.LLM_API_KEY) return json({ error: 'Server missing LLM_API_KEY' }, 500, c);
  if (Number(request.headers.get('content-length') || 0) > 80000) return json({ error: 'Payload too large' }, 413, c);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON' }, 400, c); }
  const system = String(body.system || '').slice(0, 40000);
  const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-12);
  const wantStream = !!body.stream;

  if (env.TURNSTILE_SECRET) {
    const ok = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstile, request.headers.get('cf-connecting-ip'));
    if (!ok) return json({ error: 'Verification failed' }, 403, c);
  }
  if (env.RATE_KV) {
    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const k = 'rl:' + ip;
    const n = parseInt((await env.RATE_KV.get(k)) || '0', 10);
    const _rmax = parseInt(env.RATE_MAX || '60', 10);
    if (n >= _rmax) return json({ error: 'Rate limit — give it a moment.' }, 429, c);
    await env.RATE_KV.put(k, String(n + 1), { expirationTtl: 600 });
  }

  const provider = (env.LLM_PROVIDER || 'anthropic').toLowerCase();
  const primary = env.LLM_MODEL || (provider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini');
  const fallbackModel = env.LLM_FALLBACK_MODEL || (provider === 'anthropic' ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini');
  const callModel = (model, stream) => provider === 'anthropic'
    ? fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env.LLM_API_KEY, 'anthropic-version': '2023-06-01' }, body: JSON.stringify({ model, max_tokens: 700, system, messages, stream }) })
    : fetch(env.LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.LLM_API_KEY }, body: JSON.stringify({ model, temperature: 0.4, max_tokens: 700, messages: [{ role: 'system', content: system }, ...messages], stream }) });
  const readText = j => provider === 'anthropic'
    ? (j.content && j.content[0] && j.content[0].text) || ''
    : (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  try {
    let upstream = null;
    try { upstream = await callModel(primary, wantStream); } catch (e) { upstream = null; }
    if (!upstream || !upstream.ok) {
      // Self-heal: one retry on a fast fallback model so a transient blip or a
      // primary-model issue does not take the coach offline mid-draft.
      let fb = null;
      try { fb = await callModel(fallbackModel, wantStream); } catch (e) { fb = null; }
      if (fb && fb.ok) {
        if (wantStream) return streamResponse(fb, provider, c);
        return json({ text: readText(await fb.json()) }, 200, c);
      }
      const j = upstream ? await upstream.json().catch(() => ({})) : {};
      return json({ error: (j.error && j.error.message) || 'Provider unavailable' }, 502, c);
    }
    if (wantStream) return streamResponse(upstream, provider, c);
    return json({ text: readText(await upstream.json()) }, 200, c);
  } catch (e) {
    return json({ error: String(e) }, 500, c);
  }
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret); form.append('response', token); if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const j = await r.json().catch(() => ({}));
  return !!j.success;
}

function streamResponse(upstream, provider, c) {
  const reader = upstream.body.getReader();
  const dec = new TextDecoder(); const enc = new TextEncoder();
  let buf = '';
  const stream = new ReadableStream({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) { controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close(); return; }
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          let delta = '';
          if (provider === 'anthropic') { if (j.type === 'content_block_delta' && j.delta && j.delta.text) delta = j.delta.text; }
          else { delta = (j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content) || ''; }
          if (delta) controller.enqueue(enc.encode('data: ' + JSON.stringify(delta) + '\n\n'));
        } catch (e) {}
      }
    },
    cancel() { try { reader.cancel(); } catch (e) {} },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', ...c } });
}
