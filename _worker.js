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
  { name: "Josh Allen", position: "QB", team: "BUF", projectedStats: { passYd: 3706, passTD: 30, passInt: 13, rushYd: 607, rushTD: 11, fumLost: 4 }},
  { name: "Lamar Jackson", position: "QB", team: "BAL", projectedStats: { passYd: 3366, passTD: 33, passInt: 11, rushYd: 604, rushTD: 3, fumLost: 4 }},
  { name: "Drake Maye", position: "QB", team: "NE", projectedStats: { passYd: 3956, passTD: 29, passInt: 11, rushYd: 550, rushTD: 4, fumLost: 6 }},
  { name: "Jayden Daniels", position: "QB", team: "WAS", projectedStats: { passYd: 3468, passTD: 27, passInt: 12, rushYd: 744, rushTD: 5, fumLost: 2 }},
  { name: "Dak Prescott", position: "QB", team: "DAL", projectedStats: { passYd: 4439, passTD: 33, passInt: 12, rushYd: 170, rushTD: 2, fumLost: 2 }},
  { name: "Joe Burrow", position: "QB", team: "CIN", projectedStats: { passYd: 4272, passTD: 35, passInt: 14, rushYd: 166, rushTD: 1, fumLost: 1 }},
  { name: "Jalen Hurts", position: "QB", team: "PHI", projectedStats: { passYd: 3374, passTD: 26, passInt: 6, rushYd: 492, rushTD: 8, fumLost: 4 }},
  { name: "Trevor Lawrence", position: "QB", team: "JAX", projectedStats: { passYd: 3799, passTD: 30, passInt: 15, rushYd: 329, rushTD: 6, fumLost: 3 }},
  { name: "Jaxson Dart", position: "QB", team: "NYG", projectedStats: { passYd: 3517, passTD: 26, passInt: 14, rushYd: 529, rushTD: 7, fumLost: 2 }},
  { name: "Brock Purdy", position: "QB", team: "SF", projectedStats: { passYd: 4118, passTD: 29, passInt: 16, rushYd: 350, rushTD: 5, fumLost: 5 }},
  { name: "Patrick Mahomes", position: "QB", team: "KC", projectedStats: { passYd: 3666, passTD: 29, passInt: 13, rushYd: 438, rushTD: 4, fumLost: 1 }},
  { name: "Matthew Stafford", position: "QB", team: "LAR", projectedStats: { passYd: 4047, passTD: 34, passInt: 7, rushYd: 40, fumLost: 2 }},
  { name: "Daniel Jones", position: "QB", team: "IND", projectedStats: { passYd: 3975, passTD: 31, passInt: 12, rushYd: 174, rushTD: 4, fumLost: 3 }},
  { name: "Justin Herbert", position: "QB", team: "LAC", projectedStats: { passYd: 3776, passTD: 28, passInt: 13, rushYd: 544, rushTD: 2, fumLost: 2 }},
  { name: "Jared Goff", position: "QB", team: "DET", projectedStats: { passYd: 4229, passTD: 34, passInt: 10, rushYd: 41, fumLost: 4 }},
  { name: "Caleb Williams", position: "QB", team: "CHI", projectedStats: { passYd: 3784, passTD: 29, passInt: 10, rushYd: 403, rushTD: 2, fumLost: 2 }},
  { name: "Baker Mayfield", position: "QB", team: "TB", projectedStats: { passYd: 3945, passTD: 29, passInt: 15, rushYd: 395, rushTD: 2, fumLost: 3 }},
  { name: "Malik Willis", position: "QB", team: "MIA", projectedStats: { passYd: 3099, passTD: 26, passInt: 17, rushYd: 720, rushTD: 5, fumLost: 6 }},
  { name: "Sam Darnold", position: "QB", team: "SEA", projectedStats: { passYd: 4119, passTD: 32, passInt: 13, rushYd: 147, fumLost: 6 }},
  { name: "Bo Nix", position: "QB", team: "DEN", projectedStats: { passYd: 3513, passTD: 27, passInt: 10, rushYd: 306, rushTD: 3, fumLost: 1 }},
  { name: "C.J. Stroud", position: "QB", team: "HOU", projectedStats: { passYd: 3933, passTD: 28, passInt: 12, rushYd: 247, rushTD: 1, fumLost: 3 }},
  { name: "Tyler Shough", position: "QB", team: "NO", projectedStats: { passYd: 3994, passTD: 24, passInt: 14, rushYd: 325, rushTD: 4, fumLost: 4 }},
  { name: "Kyler Murray", position: "QB", team: "MIN", projectedStats: { passYd: 3399, passTD: 27, passInt: 21, rushYd: 490, rushTD: 4, fumLost: 4 }},
  { name: "Jordan Love", position: "QB", team: "GB", projectedStats: { passYd: 3682, passTD: 29, passInt: 10, rushYd: 184, fumLost: 2 }},
  { name: "Jacoby Brissett", position: "QB", team: "ARI", projectedStats: { passYd: 3769, passTD: 25, passInt: 12, rushYd: 259, rushTD: 2, fumLost: 6 }},
  { name: "Tua Tagovailoa", position: "QB", team: "ATL", projectedStats: { passYd: 3457, passTD: 24, passInt: 10, rushYd: 56, fumLost: 2 }},
  { name: "Bryce Young", position: "QB", team: "CAR", projectedStats: { passYd: 3110, passTD: 22, passInt: 16, rushYd: 264, rushTD: 3, fumLost: 2 }},
  { name: "Aaron Rodgers", position: "QB", team: "PIT", projectedStats: { passYd: 3076, passTD: 24, passInt: 9, rushYd: 71, rushTD: 1, fumLost: 2 }},
  { name: "Cam Ward", position: "QB", team: "TEN", projectedStats: { passYd: 3155, passTD: 22, passInt: 9, rushYd: 158, rushTD: 3, fumLost: 6 }},
  { name: "Geno Smith", position: "QB", team: "NYJ", projectedStats: { passYd: 2939, passTD: 24, passInt: 16, rushYd: 250, rushTD: 1, fumLost: 1 }},
  { name: "Fernando Mendoza", position: "QB", team: "LV", projectedStats: { passYd: 2637, passTD: 19, passInt: 16, rushYd: 236, rushTD: 1, fumLost: 2 }},
  { name: "Deshaun Watson", position: "QB", team: "CLE", projectedStats: { passYd: 1882, passTD: 12, passInt: 12, rushYd: 187, rushTD: 2, fumLost: 4 }},
  { name: "Shedeur Sanders", position: "QB", team: "CLE", projectedStats: { passYd: 1256, passTD: 8, passInt: 8, rushYd: 129, rushTD: 1, fumLost: 1 }},
  { name: "Ty Simpson", position: "QB", team: "LAR", projectedStats: { passYd: 452, passTD: 4, passInt: 1, rushYd: 30 }},
  { name: "Michael Penix Jr.", position: "QB", team: "ATL", projectedStats: { passYd: 609, passTD: 4, passInt: 2, rushYd: 17 }},
  { name: "Kirk Cousins", position: "QB", team: "LV", projectedStats: { passYd: 673, passTD: 5, passInt: 4, rushYd: 6, fumLost: 1 }},
  { name: "Marcus Mariota", position: "QB", team: "WAS", projectedStats: { passYd: 348, passTD: 3, passInt: 1, rushYd: 3 }},
  { name: "Quinn Ewers", position: "QB", team: "MIA", projectedStats: { passYd: 125, passTD: 1, passInt: 1, rushYd: 20, rec: 5, recYd: -28, recTD: 0 }},
  { name: "Desmond Ridder", position: "QB", team: "GB", projectedStats: { passYd: 153, passTD: 1, passInt: 0, rushYd: 24 }},
  { name: "Joe Milton III", position: "QB", team: "DAL", projectedStats: { passYd: 178, passTD: 1, passInt: 0, rushYd: 20 }},
  { name: "Tyler Huntley", position: "QB", team: "BAL", projectedStats: { passYd: 134, passTD: 1, passInt: 0, rushYd: 26 }},
  { name: "Davis Mills", position: "QB", team: "HOU", projectedStats: { passYd: 159, passTD: 1, passInt: 0, rushYd: 20 }},
  { name: "Shane Buechele", position: "QB", team: "BUF", projectedStats: { passYd: 147, passTD: 1, passInt: 0, rushYd: 18 }},
  { name: "Mason Rudolph", position: "QB", team: "PIT", projectedStats: { passYd: 135, passTD: 1, passInt: 0, rushYd: 14 }},
  { name: "Jarrett Stidham", position: "QB", team: "DEN", projectedStats: { passYd: 146, passTD: 1, passInt: 0, rushYd: 18 }},
  { name: "Will Levis", position: "QB", team: "TEN", projectedStats: { passYd: 130, passTD: 1, passInt: 0, rushYd: 20 }},
  { name: "Gardner Minshew", position: "QB", team: "ARI", projectedStats: { passYd: 153, passTD: 1, passInt: 0, rushYd: 19 }},
  { name: "Garrett Nussmeier", position: "QB", team: "KC", projectedStats: { passYd: 111, passTD: 1, passInt: 0, rushYd: 5 }},
  { name: "Behren Morton", position: "QB", team: "NE", projectedStats: { passYd: 122, passTD: 1, passInt: 0, rushYd: 7 }},
  { name: "Seth Henigan", position: "QB", team: "IND", projectedStats: { passYd: 125, passTD: 1, passInt: 0, rushYd: 6 }},
  { name: "Joshua Dobbs", position: "QB", team: "NE", projectedStats: { passYd: 158, passTD: 1, passInt: 0, rushYd: 12 }},
  { name: "Tanner McKee", position: "QB", team: "PHI", projectedStats: { passYd: 128, passTD: 1, passInt: 0, rushYd: 18 }},
  { name: "Teddy Bridgewater", position: "QB", team: "DET", projectedStats: { passYd: 165, passTD: 1, passInt: 0, rushYd: 15 }},
  { name: "Cade Klubnik", position: "QB", team: "NYJ", projectedStats: { passYd: 87, passTD: 1, passInt: 0, rushYd: 12 }},
  { name: "Tyson Bagent", position: "QB", team: "CHI", projectedStats: { passYd: 151, passTD: 1, passInt: 0, rushYd: 13 }},
  { name: "Mitch Trubisky", position: "QB", team: "TEN", projectedStats: { passYd: 113, passTD: 1, passInt: 0, rushYd: 5 }},
  { name: "Cole Payton", position: "QB", team: "PHI", projectedStats: { passYd: 102, passTD: 1, passInt: 0, rushYd: 7 }},
  { name: "Adrian Martinez", position: "QB", team: "SF", projectedStats: { passYd: 118, passTD: 1, passInt: 0, rushYd: 6 }},
  { name: "Carson Beck", position: "QB", team: "ARI", projectedStats: { passYd: 114, passTD: 1, passInt: 0, rushYd: 10 }},
  { name: "Kyle Allen", position: "QB", team: "BUF", projectedStats: { passYd: 94, passTD: 1, passInt: 0, rushYd: 3 }},
  { name: "Will Howard", position: "QB", team: "PIT", projectedStats: { passYd: 104, passTD: 1, passInt: 0, rushYd: 5 }},
  { name: "Nick Mullens", position: "QB", team: "JAX", projectedStats: { passYd: 104, passTD: 1, passInt: 0, rushYd: 4 }},
  { name: "Jalen Milroe", position: "QB", team: "SEA", projectedStats: { passYd: 92, passTD: 1, passInt: 0, rushYd: 16 }},
  { name: "Drew Allar", position: "QB", team: "PIT", projectedStats: { passYd: 105, passTD: 1, passInt: 0, rushYd: 9 }},
  // ── RB (CBS/SportsLine 2026, adjusted) ──
  { name: "Bijan Robinson", position: "RB", team: "ATL", projectedStats: { rushYd: 1508, rushTD: 11, rec: 79, recYd: 798, recTD: 4, fumLost: 2 }},
  { name: "Jahmyr Gibbs", position: "RB", team: "DET", projectedStats: { rushYd: 1349, rushTD: 15, rec: 73, recYd: 626, recTD: 5, fumLost: 1 }},
  { name: "Jonathan Taylor", position: "RB", team: "IND", projectedStats: { rushYd: 1585, rushTD: 15, rec: 48, recYd: 343, recTD: 2, fumLost: 2 }},
  { name: "Derrick Henry", position: "RB", team: "BAL", projectedStats: { rushYd: 1652, rushTD: 15, rec: 16, recYd: 160, recTD: 1, fumLost: 2 }},
  { name: "De'Von Achane", position: "RB", team: "MIA", projectedStats: { rushYd: 1130, rushTD: 7, rec: 75, recYd: 547, recTD: 6, fumLost: 1 }},
  { name: "Christian McCaffrey", position: "RB", team: "SF", projectedStats: { rushYd: 941, rushTD: 8, rec: 69, recYd: 623, recTD: 5, fumLost: 1 }},
  { name: "Chase Brown", position: "RB", team: "CIN", projectedStats: { rushYd: 1006, rushTD: 9, rec: 72, recYd: 473, recTD: 5, fumLost: 1 }},
  { name: "Ashton Jeanty", position: "RB", team: "LV", projectedStats: { rushYd: 1046, rushTD: 10, rec: 55, recYd: 339, recTD: 5, fumLost: 1 }},
  { name: "James Cook", position: "RB", team: "BUF", projectedStats: { rushYd: 1437, rushTD: 9, rec: 32, recYd: 269, recTD: 2, fumLost: 3 }},
  { name: "Saquon Barkley", position: "RB", team: "PHI", projectedStats: { rushYd: 1409, rushTD: 7, rec: 40, recYd: 314, recTD: 2, fumLost: 1 }},
  { name: "Josh Jacobs", position: "RB", team: "GB", projectedStats: { rushYd: 1092, rushTD: 13, rec: 36, recYd: 293, recTD: 1, fumLost: 1 }},
  { name: "Cam Skattebo", position: "RB", team: "NYG", projectedStats: { rushYd: 953, rushTD: 9, rec: 42, recYd: 360, recTD: 4, fumLost: 2 }},
  { name: "Kyren Williams", position: "RB", team: "LAR", projectedStats: { rushYd: 1114, rushTD: 10, rec: 33, recYd: 249, recTD: 3, fumLost: 2 }},
  { name: "Breece Hall", position: "RB", team: "NYJ", projectedStats: { rushYd: 1150, rushTD: 7, rec: 43, recYd: 397, recTD: 2, fumLost: 2 }},
  { name: "Omarion Hampton", position: "RB", team: "LAC", projectedStats: { rushYd: 937, rushTD: 11, rec: 47, recYd: 300, recTD: 2, fumLost: 1 }},
  { name: "Bucky Irving", position: "RB", team: "TB", projectedStats: { rushYd: 1025, rushTD: 6, rec: 44, recYd: 398, recTD: 3, fumLost: 1 }},
  { name: "Travis Etienne", position: "RB", team: "NO", projectedStats: { rushYd: 993, rushTD: 5, rec: 47, recYd: 357, recTD: 5, fumLost: 1 }},
  { name: "D'Andre Swift", position: "RB", team: "CHI", projectedStats: { rushYd: 1114, rushTD: 9, rec: 35, recYd: 316, recTD: 1, fumLost: 1 }},
  { name: "Jeremiyah Love", position: "RB", team: "ARI", projectedStats: { rushYd: 1026, rushTD: 8, rec: 42, recYd: 355, recTD: 2, fumLost: 3 }},
  { name: "Javonte Williams", position: "RB", team: "DAL", projectedStats: { rushYd: 1087, rushTD: 11, rec: 29, recYd: 140, recTD: 1, fumLost: 2 }},
  { name: "Kenneth Walker III", position: "RB", team: "KC", projectedStats: { rushYd: 1066, rushTD: 7, rec: 45, recYd: 346, recTD: 0, fumLost: 1 }},
  { name: "Rico Dowdle", position: "RB", team: "PIT", projectedStats: { rushYd: 929, rushTD: 8, rec: 38, recYd: 266, recTD: 2, fumLost: 1 }},
  { name: "Bhayshul Tuten", position: "RB", team: "JAX", projectedStats: { rushYd: 934, rushTD: 11, rec: 16, recYd: 129, recTD: 3, fumLost: 3 }},
  { name: "TreVeyon Henderson", position: "RB", team: "NE", projectedStats: { rushYd: 949, rushTD: 8, rec: 34, recYd: 210, recTD: 1, fumLost: 1 }},
  { name: "Quinshon Judkins", position: "RB", team: "CLE", projectedStats: { rushYd: 947, rushTD: 9, rec: 31, recYd: 221, recTD: 0, fumLost: 1 }},
  { name: "RJ Harvey", position: "RB", team: "DEN", projectedStats: { rushYd: 582, rushTD: 6, rec: 47, recYd: 343, recTD: 5, fumLost: 1 }},
  { name: "Jaylen Warren", position: "RB", team: "PIT", projectedStats: { rushYd: 838, rushTD: 6, rec: 40, recYd: 323, recTD: 2, fumLost: 1 }},
  { name: "Jadarian Price", position: "RB", team: "SEA", projectedStats: { rushYd: 976, rushTD: 8, rec: 20, recYd: 224, recTD: 1, fumLost: 3 }},
  { name: "David Montgomery", position: "RB", team: "HOU", projectedStats: { rushYd: 948, rushTD: 8, rec: 26, recYd: 207, recTD: 0, fumLost: 1 }},
  { name: "Rhamondre Stevenson", position: "RB", team: "NE", projectedStats: { rushYd: 745, rushTD: 7, rec: 34, recYd: 335, recTD: 2, fumLost: 3 }},
  { name: "Tony Pollard", position: "RB", team: "TEN", projectedStats: { rushYd: 1038, rushTD: 6, rec: 32, recYd: 200, recTD: 0, fumLost: 3 }},
  { name: "Chuba Hubbard", position: "RB", team: "CAR", projectedStats: { rushYd: 844, rushTD: 5, rec: 33, recYd: 211, recTD: 3, fumLost: 2 }},
  { name: "J.K. Dobbins", position: "RB", team: "DEN", projectedStats: { rushYd: 1083, rushTD: 6, rec: 20, recYd: 76, recTD: 0, fumLost: 1 }},
  { name: "Kenneth Gainwell", position: "RB", team: "TB", projectedStats: { rushYd: 536, rushTD: 4, rec: 60, recYd: 435, recTD: 2, fumLost: 1 }},
  { name: "Jordan Mason", position: "RB", team: "MIN", projectedStats: { rushYd: 901, rushTD: 7, rec: 18, recYd: 81, recTD: 0, fumLost: 1 }},
  { name: "Jacory Croskey-Merritt", position: "RB", team: "WAS", projectedStats: { rushYd: 857, rushTD: 8, rec: 10, recYd: 73, recTD: 0, fumLost: 2 }},
  { name: "Aaron Jones", position: "RB", team: "MIN", projectedStats: { rushYd: 706, rushTD: 3, rec: 39, recYd: 300, recTD: 2, fumLost: 2 }},
  { name: "Kyle Monangai", position: "RB", team: "CHI", projectedStats: { rushYd: 854, rushTD: 5, rec: 23, recYd: 199, recTD: 0, fumLost: 1 }},
  { name: "Rachaad White", position: "RB", team: "WAS", projectedStats: { rushYd: 707, rushTD: 6, rec: 26, recYd: 172, recTD: 1, fumLost: 1 }},
  { name: "Tyrone Tracy Jr.", position: "RB", team: "NYG", projectedStats: { rushYd: 615, rushTD: 3, rec: 31, recYd: 249, recTD: 2, fumLost: 1 }},
  { name: "Blake Corum", position: "RB", team: "LAR", projectedStats: { rushYd: 821, rushTD: 6, rec: 6, recYd: 36, recTD: 0, fumLost: 1 }},
  { name: "Woody Marks", position: "RB", team: "HOU", projectedStats: { rushYd: 565, rushTD: 3, rec: 21, recYd: 177, recTD: 3, fumLost: 1 }},
  { name: "Chris Rodriguez Jr.", position: "RB", team: "JAC", projectedStats: { rushYd: 670, rushTD: 7, rec: 2, recYd: 19, recTD: 0, fumLost: 1 }},
  { name: "Zach Charbonnet", position: "RB", team: "SEA", projectedStats: { rushYd: 505, rushTD: 7, rec: 20, recYd: 162, recTD: 0, fumLost: 1 }},
  { name: "Tyjae Spears", position: "RB", team: "TEN", projectedStats: { rushYd: 367, rushTD: 4, rec: 48, recYd: 306, recTD: 0, fumLost: 1 }},
  { name: "Isiah Pacheco", position: "RB", team: "DET", projectedStats: { rushYd: 613, rushTD: 3, rec: 26, recYd: 158, recTD: 1, fumLost: 1 }},
  { name: "Jonathon Brooks", position: "RB", team: "CAR", projectedStats: { rushYd: 617, rushTD: 4, rec: 18, recYd: 157, recTD: 1, fumLost: 2 }},
  { name: "Kaelon Black", position: "RB", team: "SF", projectedStats: { rushYd: 593, rushTD: 5, rec: 13, recYd: 129, recTD: 1, fumLost: 2 }},
  { name: "Jordan James", position: "RB", team: "SF", projectedStats: { rushYd: 495, rushTD: 4, rec: 24, recYd: 235, recTD: 1, fumLost: 2 }},
  { name: "James Conner", position: "RB", team: "ARI", projectedStats: { rushYd: 311, rushTD: 3, rec: 36, recYd: 261, recTD: 2 }},
  { name: "Justice Hill", position: "RB", team: "BAL", projectedStats: { rushYd: 328, rushTD: 3, rec: 30, recYd: 255, recTD: 2 }},
  { name: "Dylan Sampson", position: "RB", team: "CLE", projectedStats: { rushYd: 283, rushTD: 2, rec: 36, recYd: 311, recTD: 3, fumLost: 2 }},
  { name: "Adam Randall", position: "RB", team: "BAL", projectedStats: { rushYd: 439, rushTD: 3, rec: 17, recYd: 177, recTD: 2, fumLost: 1 }},
  { name: "Brian Robinson Jr.", position: "RB", team: "ATL", projectedStats: { rushYd: 570, rushTD: 5, rec: 5, recYd: 24, recTD: 0, fumLost: 1 }},
  { name: "Malik Davis", position: "RB", team: "DAL", projectedStats: { rushYd: 556, rushTD: 4, rec: 9, recYd: 76, recTD: 0 }},
  { name: "Tyler Allgeier", position: "RB", team: "ARI", projectedStats: { rushYd: 468, rushTD: 5, rec: 16, recYd: 88, recTD: 0, fumLost: 1 }},
  { name: "Emari Demercado", position: "RB", team: "KC", projectedStats: { rushYd: 602, rushTD: 2, rec: 17, recYd: 131, recTD: 1, fumLost: 3 }},
  { name: "Ty Johnson", position: "RB", team: "BUF", projectedStats: { rushYd: 222, rushTD: 2, rec: 24, recYd: 276, recTD: 3 }},
  { name: "Braelon Allen", position: "RB", team: "NYJ", projectedStats: { rushYd: 438, rushTD: 5, rec: 13, recYd: 98, recTD: 1, fumLost: 3 }},
  { name: "Emanuel Wilson", position: "RB", team: "SEA", projectedStats: { rushYd: 532, rushTD: 3, rec: 14, recYd: 91, recTD: 0, fumLost: 1 }},
  { name: "Christopher Brooks", position: "RB", team: "GB", projectedStats: { rushYd: 551, rushTD: 2, rec: 15, recYd: 107, recTD: 0, fumLost: 1 }},
  { name: "AJ Dillon", position: "RB", team: "CAR", projectedStats: { rushYd: 500, rushTD: 3, rec: 16, recYd: 131, recTD: 1, fumLost: 5 }},
  { name: "Jawhar Jordan", position: "RB", team: "HOU", projectedStats: { rushYd: 381, rushTD: 2, rec: 23, recYd: 176, recTD: 1, fumLost: 1 }},
  { name: "Samaje Perine", position: "RB", team: "CIN", projectedStats: { rushYd: 442, rushTD: 4, rec: 17, recYd: 130, recTD: 0, fumLost: 3 }},
  { name: "Mike Washington Jr.", position: "RB", team: "LV", projectedStats: { rushYd: 338, rushTD: 2, rec: 22, recYd: 183, recTD: 1, fumLost: 1 }},
  { name: "Keaton Mitchell", position: "RB", team: "LAC", projectedStats: { rushYd: 500, rushTD: 2, rec: 11, recYd: 69, recTD: 0, fumLost: 1 }},
  { name: "Kimani Vidal", position: "RB", team: "LAC", projectedStats: { rushYd: 351, rushTD: 2, rec: 16, recYd: 146, recTD: 1 }},
  { name: "Kendre Miller", position: "RB", team: "NO", projectedStats: { rushYd: 363, rushTD: 4, rec: 8, recYd: 60, recTD: 0 }},
  { name: "Tank Bigsby", position: "RB", team: "PHI", projectedStats: { rushYd: 467, rushTD: 3, rec: 3, recYd: 33, recTD: 0 }},
  { name: "Kyle Juszczyk", position: "RB", team: "SF", projectedStats: { rushYd: 2, rec: 27, recYd: 253, recTD: 2 }},
  { name: "Jaylen Wright", position: "RB", team: "MIA", projectedStats: { rushYd: 387, rushTD: 2, rec: 7, recYd: 47, recTD: 0, fumLost: 2 }},
  { name: "Brashard Smith", position: "RB", team: "KC", projectedStats: { rushYd: 180, rushTD: 1, rec: 21, recYd: 142, recTD: 1 }},
  { name: "Devin Neal", position: "RB", team: "NO", projectedStats: { rushYd: 179, rushTD: 2, rec: 5, recYd: 33, recTD: 0 }},
  { name: "Frank Gore Jr.", position: "RB", team: "BUF", projectedStats: { rushYd: 177, rushTD: 2, rec: 3, recYd: 28, recTD: 0 }},
  { name: "Roschon Johnson", position: "RB", team: "CHI", projectedStats: { rushYd: 119, rushTD: 3, rec: 3, recYd: 14, recTD: 0 }},
  { name: "Jerome Ford", position: "RB", team: "WAS", projectedStats: { rushYd: 191, rushTD: 1, rec: 8, recYd: 45, recTD: 0 }},
  { name: "Isaiah Davis", position: "RB", team: "NYJ", projectedStats: { rushYd: 169, rushTD: 1, rec: 7, recYd: 59, recTD: 0 }},
  { name: "Phil Mafah", position: "RB", team: "DAL", projectedStats: { rushYd: 139, rushTD: 2, rec: 4, recYd: 37, recTD: 0 }},
  { name: "Ty Chandler", position: "RB", team: "NO", projectedStats: { rushYd: 143, rushTD: 1, rec: 12, recYd: 55, recTD: 0 }},
  { name: "Seth McGowan", position: "RB", team: "IND", projectedStats: { rushYd: 145, rushTD: 2, rec: 2, recYd: 23, recTD: 0 }},
  { name: "Sean Tucker", position: "RB", team: "TB", projectedStats: { rushYd: 142, rushTD: 2, rec: 1, recYd: 5, recTD: 0 }},
  { name: "Kaytron Allen", position: "RB", team: "WAS", projectedStats: { rushYd: 172, rushTD: 1, rec: 2, recYd: 20, recTD: 0 }},
  { name: "Austin Ekeler", position: "RB", team: "WAS", projectedStats: { rushYd: 148, rushTD: 1, rec: 6, recYd: 65, recTD: 0 }},
  { name: "Michael Burton", position: "RB", team: "CLE", projectedStats: { rushYd: 11, rushTD: 1, rec: 6, recYd: 40, recTD: 1 }},
  { name: "Andrew Beck", position: "RB", team: "NYJ", projectedStats: { rushYd: 11, rec: 5, recYd: 34, recTD: 2 }},
  { name: "Jeremy McNichols", position: "RB", team: "WAS", projectedStats: { rushYd: 85, rushTD: 1, rec: 7, recYd: 55, recTD: 0 }},
  { name: "Isaac Guerendo", position: "RB", team: "SF", projectedStats: { rushYd: 162, rushTD: 1, rec: 4, recYd: 35, recTD: 0 }},
  { name: "Ameer Abdullah", position: "RB", team: "JAX", projectedStats: { rushYd: 73, rushTD: 1, rec: 8, recYd: 56, recTD: 0 }},
  { name: "Jam Miller", position: "RB", team: "NE", projectedStats: { rushYd: 155, rushTD: 1, rec: 2, recYd: 24, recTD: 0 }},
  { name: "Dare Ogunbowale", position: "RB", team: "HOU", projectedStats: { rushYd: 70, rushTD: 1, rec: 7, recYd: 66, recTD: 0 }},
  { name: "Elijah Mitchell", position: "RB", team: "PHI", projectedStats: { rushYd: 157, rushTD: 1, rec: 2, recYd: 20, recTD: 0 }},
  { name: "Zavier Scott", position: "RB", team: "MIN", projectedStats: { rushYd: 107, rec: 6, recYd: 48, recTD: 1 }},
  // ── WR (CBS/SportsLine 2026, adjusted) ──
  { name: "Jaxon Smith-Njigba", position: "WR", team: "SEA", projectedStats: { rushYd: 33, rec: 122, recYd: 1772, recTD: 13, fumLost: 1 }},
  { name: "Puka Nacua", position: "WR", team: "LAR", projectedStats: { rushYd: 110, rushTD: 2, rec: 129, recYd: 1702, recTD: 9, fumLost: 1 }},
  { name: "Ja'Marr Chase", position: "WR", team: "CIN", projectedStats: { rushYd: 22, rec: 129, recYd: 1555, recTD: 10, fumLost: 1 }},
  { name: "Drake London", position: "WR", team: "ATL", projectedStats: { rec: 104, recYd: 1425, recTD: 14, fumLost: 1 }},
  { name: "Amon-Ra St. Brown", position: "WR", team: "DET", projectedStats: { rushYd: 9, rec: 115, recYd: 1363, recTD: 11 }},
  { name: "Rashee Rice", position: "WR", team: "KC", projectedStats: { rushYd: 31, rushTD: 2, rec: 104, recYd: 1044, recTD: 13 }},
  { name: "George Pickens", position: "WR", team: "DAL", projectedStats: { rushYd: -1, rec: 94, recYd: 1391, recTD: 10 }},
  { name: "Chris Olave", position: "WR", team: "NO", projectedStats: { rec: 98, recYd: 1234, recTD: 10 }},
  { name: "A.J. Brown", position: "WR", team: "NE", projectedStats: { rec: 94, recYd: 1334, recTD: 9 }},
  { name: "CeeDee Lamb", position: "WR", team: "DAL", projectedStats: { rushYd: 22, rec: 102, recYd: 1332, recTD: 6 }},
  { name: "Nico Collins", position: "WR", team: "HOU", projectedStats: { rushYd: 10, rushTD: 1, rec: 82, recYd: 1240, recTD: 8, fumLost: 1 }},
  { name: "Zay Flowers", position: "WR", team: "BAL", projectedStats: { rushYd: 58, rushTD: 1, rec: 85, recYd: 1216, recTD: 8, fumLost: 2 }},
  { name: "Justin Jefferson", position: "WR", team: "MIN", projectedStats: { rushYd: 5, rec: 90, recYd: 1238, recTD: 6 }},
  { name: "Tee Higgins", position: "WR", team: "CIN", projectedStats: { rec: 74, recYd: 1035, recTD: 11 }},
  { name: "DeVonta Smith", position: "WR", team: "PHI", projectedStats: { rec: 90, recYd: 1154, recTD: 6 }},
  { name: "Malik Nabers", position: "WR", team: "NYG", projectedStats: { rushYd: 2, rec: 74, recYd: 995, recTD: 11 }},
  { name: "Garrett Wilson", position: "WR", team: "NYJ", projectedStats: { rushYd: 2, rec: 89, recYd: 954, recTD: 9, fumLost: 1 }},
  { name: "Emeka Egbuka", position: "WR", team: "TB", projectedStats: { rushYd: 9, rec: 71, recYd: 1116, recTD: 8 }},
  { name: "Terry McLaurin", position: "WR", team: "WAS", projectedStats: { rushYd: 1, rec: 69, recYd: 969, recTD: 10 }},
  { name: "Alec Pierce", position: "WR", team: "IND", projectedStats: { rec: 58, recYd: 1108, recTD: 9 }},
  { name: "Courtland Sutton", position: "WR", team: "DEN", projectedStats: { rec: 76, recYd: 972, recTD: 8 }},
  { name: "Jameson Williams", position: "WR", team: "DET", projectedStats: { rushYd: 38, rushTD: 1, rec: 63, recYd: 1080, recTD: 7 }},
  { name: "Tetairoa McMillan", position: "WR", team: "CAR", projectedStats: { rec: 73, recYd: 1066, recTD: 7, fumLost: 1 }},
  { name: "Rome Odunze", position: "WR", team: "CHI", projectedStats: { rushYd: 4, rec: 66, recYd: 964, recTD: 9 }},
  { name: "Davante Adams", position: "WR", team: "LAR", projectedStats: { rec: 68, recYd: 852, recTD: 10 }},
  { name: "Ladd McConkey", position: "WR", team: "LAC", projectedStats: { rec: 75, recYd: 941, recTD: 7 }},
  { name: "Luther Burden III", position: "WR", team: "CHI", projectedStats: { rushYd: 35, rec: 73, recYd: 1005, recTD: 6 }},
  { name: "Jaylen Waddle", position: "WR", team: "DEN", projectedStats: { rushYd: 27, rec: 75, recYd: 974, recTD: 6 }},
  { name: "Marvin Harrison Jr.", position: "WR", team: "ARI", projectedStats: { rec: 69, recYd: 944, recTD: 7 }},
  { name: "DJ Moore", position: "WR", team: "BUF", projectedStats: { rushYd: 78, rushTD: 1, rec: 69, recYd: 797, recTD: 8, fumLost: 1 }},
  { name: "Mike Evans", position: "WR", team: "SF", projectedStats: { rec: 69, recYd: 893, recTD: 7 }},
  { name: "Jakobi Meyers", position: "WR", team: "JAX", projectedStats: { rushYd: 16, rec: 76, recYd: 898, recTD: 6, fumLost: 1 }},
  { name: "Wan'Dale Robinson", position: "WR", team: "TEN", projectedStats: { rushYd: 4, rec: 89, recYd: 835, recTD: 4 }},
  { name: "DK Metcalf", position: "WR", team: "PIT", projectedStats: { rushYd: 11, rushTD: 1, rec: 62, recYd: 903, recTD: 6 }},
  { name: "Parker Washington", position: "WR", team: "JAX", projectedStats: { rushYd: 2, rec: 61, recYd: 911, recTD: 7 }},
  { name: "Chris Godwin", position: "WR", team: "TB", projectedStats: { rushYd: 1, rec: 75, recYd: 842, recTD: 6 }},
  { name: "Quentin Johnston", position: "WR", team: "LAC", projectedStats: { rushYd: 10, rec: 58, recYd: 786, recTD: 9, fumLost: 1 }},
  { name: "Josh Downs", position: "WR", team: "IND", projectedStats: { rushYd: 2, rec: 78, recYd: 717, recTD: 6, fumLost: 1 }},
  { name: "Christian Watson", position: "WR", team: "GB", projectedStats: { rushYd: 13, rec: 48, recYd: 855, recTD: 8 }},
  { name: "Michael Pittman", position: "WR", team: "PIT", projectedStats: { rec: 77, recYd: 685, recTD: 6 }},
  { name: "Michael Wilson", position: "WR", team: "ARI", projectedStats: { rushYd: 2, rec: 66, recYd: 799, recTD: 6 }},
  { name: "Brian Thomas Jr.", position: "WR", team: "JAX", projectedStats: { rushYd: 30, rushTD: 1, rec: 54, recYd: 835, recTD: 6 }},
  { name: "Khalil Shakir", position: "WR", team: "BUF", projectedStats: { rushYd: 4, rec: 75, recYd: 712, recTD: 5, fumLost: 1 }},
  { name: "Tank Dell", position: "WR", team: "HOU", projectedStats: { rushYd: 52, rec: 62, recYd: 806, recTD: 5 }},
  { name: "Jordan Addison", position: "WR", team: "MIN", projectedStats: { rushYd: 81, rushTD: 1, rec: 50, recYd: 732, recTD: 6 }},
  { name: "Jordyn Tyson", position: "WR", team: "NO", projectedStats: { rushYd: 8, rec: 61, recYd: 872, recTD: 4, fumLost: 2 }},
  { name: "Ricky Pearsall", position: "WR", team: "SF", projectedStats: { rushYd: 19, rec: 62, recYd: 851, recTD: 3 }},
  { name: "Jayden Reed", position: "WR", team: "GB", projectedStats: { rushYd: 125, rec: 59, recYd: 726, recTD: 5 }},
  { name: "Romeo Doubs", position: "WR", team: "NE", projectedStats: { rec: 56, recYd: 729, recTD: 6 }},
  { name: "John Metchie III", position: "WR", team: "CAR", projectedStats: { rushYd: -4, rec: 64, recYd: 598, recTD: 5 }},
  { name: "Jauan Jennings", position: "WR", team: "MIN", projectedStats: { rec: 51, recYd: 626, recTD: 7, fumLost: 1 }},
  { name: "Xavier Worthy", position: "WR", team: "KC", projectedStats: { rushYd: 148, rushTD: 1, rec: 53, recYd: 644, recTD: 4 }},
  { name: "Makai Lemon", position: "WR", team: "PHI", projectedStats: { rushYd: 16, rec: 55, recYd: 761, recTD: 4, fumLost: 2 }},
  { name: "Cooper Kupp", position: "WR", team: "SEA", projectedStats: { rushYd: 3, rec: 57, recYd: 698, recTD: 4, fumLost: 1 }},
  { name: "Troy Franklin", position: "WR", team: "DEN", projectedStats: { rushYd: 12, rec: 56, recYd: 576, recTD: 6, fumLost: 1 }},
  { name: "Jalen Coker", position: "WR", team: "CAR", projectedStats: { rec: 53, recYd: 679, recTD: 5, fumLost: 1 }},
  { name: "Calvin Ridley", position: "WR", team: "TEN", projectedStats: { rushYd: 26, rushTD: 1, rec: 48, recYd: 803, recTD: 2 }},
  { name: "Carnell Tate", position: "WR", team: "TEN", projectedStats: { rushYd: 8, rec: 54, recYd: 731, recTD: 4, fumLost: 2 }},
  { name: "Theo Wease Jr.", position: "WR", team: "MIA", projectedStats: { rushYd: 9, rec: 48, recYd: 683, recTD: 5, fumLost: 1 }},
  { name: "Jerry Jeudy", position: "WR", team: "CLE", projectedStats: { rushYd: 4, rec: 55, recYd: 743, recTD: 3, fumLost: 1 }},
  { name: "Rashod Bateman", position: "WR", team: "BAL", projectedStats: { rec: 39, recYd: 576, recTD: 8 }},
  { name: "Tre Tucker", position: "WR", team: "LV", projectedStats: { rushYd: 46, rec: 52, recYd: 609, recTD: 5 }},
  { name: "Rashid Shaheed", position: "WR", team: "SEA", projectedStats: { rushYd: 93, rec: 49, recYd: 747, recTD: 3, fumLost: 1 }},
  { name: "Christian Kirk", position: "WR", team: "SF", projectedStats: { rec: 56, recYd: 637, recTD: 4 }},
  { name: "Jalen Nailor", position: "WR", team: "LV", projectedStats: { rushYd: 9, rec: 43, recYd: 576, recTD: 6 }},
  { name: "Jayden Higgins", position: "WR", team: "HOU", projectedStats: { rec: 44, recYd: 549, recTD: 6 }},
  { name: "Omar Cooper Jr.", position: "WR", team: "NYJ", projectedStats: { rushYd: 11, rec: 53, recYd: 627, recTD: 4, fumLost: 2 }},
  { name: "Antonio Williams", position: "WR", team: "WAS", projectedStats: { rushYd: 16, rec: 48, recYd: 681, recTD: 4, fumLost: 2 }},
  { name: "Kayshon Boutte", position: "WR", team: "NE", projectedStats: { rec: 37, recYd: 602, recTD: 6 }},
  { name: "Jalen McMillan", position: "WR", team: "TB", projectedStats: { rushYd: 27, rec: 46, recYd: 625, recTD: 4 }},
  { name: "Marquise Brown", position: "WR", team: "PHI", projectedStats: { rec: 44, recYd: 548, recTD: 5 }},
  { name: "Devaughn Vele", position: "WR", team: "NO", projectedStats: { rec: 45, recYd: 586, recTD: 4 }},
  { name: "Matthew Golden", position: "WR", team: "GB", projectedStats: { rushYd: 55, rec: 44, recYd: 619, recTD: 3 }},
  { name: "Elic Ayomanor", position: "WR", team: "TEN", projectedStats: { rec: 40, recYd: 535, recTD: 5 }},
  { name: "KC Concepcion", position: "WR", team: "CLE", projectedStats: { rushYd: 8, rec: 48, recYd: 609, recTD: 3, fumLost: 2 }},
  { name: "Tory Horton", position: "WR", team: "SEA", projectedStats: { rushYd: 8, rec: 38, recYd: 505, recTD: 6, fumLost: 1 }},
  { name: "Darnell Mooney", position: "WR", team: "NYG", projectedStats: { rec: 41, recYd: 600, recTD: 3 }},
  { name: "Chimere Dike", position: "WR", team: "TEN", projectedStats: { rushYd: 20, rec: 43, recYd: 406, recTD: 6, fumLost: 1 }},
  { name: "De'Zhaun Stribling", position: "WR", team: "SF", projectedStats: { rushYd: 11, rec: 44, recYd: 581, recTD: 3, fumLost: 1 }},
  { name: "Denzel Boston", position: "WR", team: "CLE", projectedStats: { rushYd: 12, rec: 44, recYd: 557, recTD: 3, fumLost: 1 }},
  { name: "Darius Slayton", position: "WR", team: "NYG", projectedStats: { rushYd: 4, rec: 40, recYd: 614, recTD: 2, fumLost: 1 }},
  { name: "Ja'Kobi Lane", position: "WR", team: "BAL", projectedStats: { rushYd: 15, rec: 35, recYd: 527, recTD: 4, fumLost: 1 }},
  { name: "Germie Bernard", position: "WR", team: "PIT", projectedStats: { rushYd: 9, rec: 42, recYd: 514, recTD: 3, fumLost: 1 }},
  { name: "Tyquan Thornton", position: "WR", team: "KC", projectedStats: { rec: 27, recYd: 574, recTD: 4 }},
  { name: "Bub Means", position: "WR", team: "NO", projectedStats: { rushYd: 10, rec: 38, recYd: 518, recTD: 3, fumLost: 1 }},
  { name: "Malik Washington", position: "WR", team: "MIA", projectedStats: { rushYd: 85, rushTD: 1, rec: 46, recYd: 351, recTD: 3, fumLost: 1 }},
  { name: "Olamide Zaccheaus", position: "WR", team: "ATL", projectedStats: { rushYd: 18, rec: 46, recYd: 414, recTD: 3 }},
  { name: "Jahdae Walker", position: "WR", team: "CHI", projectedStats: { rushYd: 6, rec: 31, recYd: 415, recTD: 5 }},
  { name: "Calvin Austin III", position: "WR", team: "NYG", projectedStats: { rec: 33, recYd: 447, recTD: 4 }},
  { name: "Andrei Iosivas", position: "WR", team: "CIN", projectedStats: { rushYd: 14, rec: 35, recYd: 474, recTD: 3 }},
  { name: "Cedric Tillman", position: "WR", team: "CLE", projectedStats: { rushYd: -1, rec: 33, recYd: 415, recTD: 4 }},
  { name: "Ted Hurst", position: "WR", team: "TB", projectedStats: { rushYd: 15, rec: 35, recYd: 486, recTD: 3, fumLost: 1 }},
  { name: "Isaac TeSlaa", position: "WR", team: "DET", projectedStats: { rec: 27, recYd: 401, recTD: 5 }},
  { name: "Ashton Dulin", position: "WR", team: "IND", projectedStats: { rushYd: 65, rec: 28, recYd: 554, recTD: 2 }},
  { name: "Dontayvion Wicks", position: "WR", team: "PHI", projectedStats: { rushYd: 5, rec: 38, recYd: 395, recTD: 3 }},
  { name: "Demarcus Robinson", position: "WR", team: "SF", projectedStats: { rushYd: 3, rec: 32, recYd: 463, recTD: 3 }},
  { name: "Xavier Hutchinson", position: "WR", team: "HOU", projectedStats: { rushYd: 15, rec: 35, recYd: 408, recTD: 3 }},
  { name: "Caleb Douglas", position: "WR", team: "MIA", projectedStats: { rushYd: 9, rec: 35, recYd: 434, recTD: 3, fumLost: 1 }},
  { name: "Josh Palmer", position: "WR", team: "BUF", projectedStats: { rec: 35, recYd: 467, recTD: 2 }},
  { name: "Zavion Thomas", position: "WR", team: "CHI", projectedStats: { rushYd: 11, rec: 33, recYd: 439, recTD: 3, fumLost: 2 }},
  { name: "Zachariah Branch", position: "WR", team: "ATL", projectedStats: { rushYd: 15, rec: 35, recYd: 502, recTD: 2, fumLost: 3 }},
  { name: "Luke McCaffrey", position: "WR", team: "WAS", projectedStats: { rec: 24, recYd: 380, recTD: 4 }},
  { name: "Kevin Austin Jr.", position: "WR", team: "NO", projectedStats: { rushYd: 8, rec: 34, recYd: 394, recTD: 2 }},
  { name: "Kendrick Bourne", position: "WR", team: "ARI", projectedStats: { rushYd: 2, rec: 33, recYd: 420, recTD: 2 }},
  { name: "Jalen Tolbert", position: "WR", team: "MIA", projectedStats: { rec: 31, recYd: 348, recTD: 3 }},
  { name: "Tez Johnson", position: "WR", team: "TB", projectedStats: { rushYd: 30, rec: 26, recYd: 305, recTD: 4 }},
  { name: "Ben Skowronek", position: "WR", team: "PIT", projectedStats: { rec: 24, recYd: 377, recTD: 3 }},
  { name: "Ryan Flournoy", position: "WR", team: "DAL", projectedStats: { rushYd: 23, rec: 29, recYd: 337, recTD: 3 }},
  { name: "Roman Wilson", position: "WR", team: "PIT", projectedStats: { rushYd: 3, rec: 28, recYd: 373, recTD: 3, fumLost: 3 }},
  { name: "Mack Hollins", position: "WR", team: "NE", projectedStats: { rushYd: 3, rec: 29, recYd: 367, recTD: 2 }},
  { name: "Adonai Mitchell", position: "WR", team: "NYJ", projectedStats: { rushYd: -1, rec: 31, recYd: 365, recTD: 2, fumLost: 1 }},
  { name: "Devontez Walker", position: "WR", team: "BAL", projectedStats: { rushYd: 3, rec: 21, recYd: 380, recTD: 3 }},
  // ── TE (CBS/SportsLine 2026, adjusted) ──
  { name: "Trey McBride", position: "TE", team: "ARI", projectedStats: { rushYd: 1, rec: 115, recYd: 1081, recTD: 8 }},
  { name: "Brock Bowers", position: "TE", team: "LV", projectedStats: { rushYd: 3, rec: 88, recYd: 994, recTD: 9 }},
  { name: "Colston Loveland", position: "TE", team: "CHI", projectedStats: { rushYd: -1, rec: 81, recYd: 1003, recTD: 8 }},
  { name: "Tyler Warren", position: "TE", team: "IND", projectedStats: { rushYd: 7, rushTD: 1, rec: 85, recYd: 906, recTD: 6 }},
  { name: "Kyle Pitts", position: "TE", team: "ATL", projectedStats: { rec: 82, recYd: 929, recTD: 7 }},
  { name: "Dallas Goedert", position: "TE", team: "PHI", projectedStats: { rushYd: 4, rushTD: 1, rec: 68, recYd: 715, recTD: 11 }},
  { name: "Harold Fannin Jr.", position: "TE", team: "CLE", projectedStats: { rushYd: 16, rushTD: 1, rec: 72, recYd: 787, recTD: 8, fumLost: 1 }},
  { name: "Sam LaPorta", position: "TE", team: "DET", projectedStats: { rec: 72, recYd: 904, recTD: 6 }},
  { name: "George Kittle", position: "TE", team: "SF", projectedStats: { rushYd: -2, rec: 72, recYd: 845, recTD: 7 }},
  { name: "Isaiah Likely", position: "TE", team: "NYG", projectedStats: { rec: 69, recYd: 901, recTD: 7, fumLost: 2 }},
  { name: "Tucker Kraft", position: "TE", team: "GB", projectedStats: { rushYd: 13, rec: 55, recYd: 815, recTD: 10 }},
  { name: "Travis Kelce", position: "TE", team: "KC", projectedStats: { rushYd: 1, rec: 78, recYd: 812, recTD: 6 }},
  { name: "Brenton Strange", position: "TE", team: "JAX", projectedStats: { rec: 70, recYd: 806, recTD: 5 }},
  { name: "Jake Ferguson", position: "TE", team: "DAL", projectedStats: { rushYd: 1, rec: 78, recYd: 638, recTD: 7, fumLost: 2 }},
  { name: "Dalton Kincaid", position: "TE", team: "BUF", projectedStats: { rec: 59, recYd: 764, recTD: 7 }},
  { name: "Juwan Johnson", position: "TE", team: "NO", projectedStats: { rec: 70, recYd: 865, recTD: 4, fumLost: 2 }},
  { name: "Mark Andrews", position: "TE", team: "BAL", projectedStats: { rushYd: 40, rushTD: 1, rec: 56, recYd: 560, recTD: 9 }},
  { name: "Hunter Henry", position: "TE", team: "NE", projectedStats: { rec: 58, recYd: 705, recTD: 6 }},
  { name: "Dalton Schultz", position: "TE", team: "HOU", projectedStats: { rec: 72, recYd: 685, recTD: 4 }},
  { name: "Cade Otton", position: "TE", team: "TB", projectedStats: { rec: 67, recYd: 708, recTD: 4 }},
  { name: "Greg Dulcich", position: "TE", team: "MIA", projectedStats: { rushYd: -11, rec: 58, recYd: 671, recTD: 4, fumLost: 2 }},
  { name: "AJ Barner", position: "TE", team: "SEA", projectedStats: { rushYd: 14, rushTD: 1, rec: 47, recYd: 475, recTD: 7 }},
  { name: "Kenyon Sadiq", position: "TE", team: "NYJ", projectedStats: { rec: 47, recYd: 529, recTD: 6, fumLost: 1 }},
  { name: "Oronde Gadsden II", position: "TE", team: "LAC", projectedStats: { rec: 49, recYd: 693, recTD: 3, fumLost: 1 }},
  { name: "T.J. Hockenson", position: "TE", team: "MIN", projectedStats: { rec: 54, recYd: 513, recTD: 4 }},
  { name: "Pat Freiermuth", position: "TE", team: "PIT", projectedStats: { rec: 47, recYd: 520, recTD: 5 }},
  { name: "Chigoziem Okonkwo", position: "TE", team: "WAS", projectedStats: { rushYd: 8, rec: 51, recYd: 596, recTD: 3 }},
  { name: "Colby Parkinson", position: "TE", team: "LAR", projectedStats: { rec: 45, recYd: 482, recTD: 6, fumLost: 1 }},
  { name: "Mason Taylor", position: "TE", team: "NYJ", projectedStats: { rec: 56, recYd: 464, recTD: 4 }},
  { name: "Mike Gesicki", position: "TE", team: "CIN", projectedStats: { rec: 49, recYd: 543, recTD: 3 }},
  { name: "Evan Engram", position: "TE", team: "DEN", projectedStats: { rushYd: 8, rec: 56, recYd: 467, recTD: 3 }},
  { name: "David Njoku", position: "TE", team: "LAC", projectedStats: { rec: 42, recYd: 406, recTD: 6 }},
  { name: "Tyler Higbee", position: "TE", team: "LAR", projectedStats: { rec: 40, recYd: 502, recTD: 4 }},
  { name: "Theo Johnson", position: "TE", team: "NYG", projectedStats: { rec: 33, recYd: 387, recTD: 5 }},
  { name: "Terrance Ferguson", position: "TE", team: "LAR", projectedStats: { rec: 26, recYd: 482, recTD: 4 }},
  { name: "Gunnar Helm", position: "TE", team: "TEN", projectedStats: { rec: 42, recYd: 356, recTD: 3 }},
  { name: "Dawson Knox", position: "TE", team: "BUF", projectedStats: { rec: 35, recYd: 395, recTD: 3 }},
  { name: "Noah Fant", position: "TE", team: "NO", projectedStats: { rec: 43, recYd: 422, recTD: 2, fumLost: 3 }},
  { name: "Michael Mayer", position: "TE", team: "LV", projectedStats: { rec: 40, recYd: 346, recTD: 2 }},
  { name: "Will Kacmarek", position: "TE", team: "MIA", projectedStats: { rec: 35, recYd: 329, recTD: 3, fumLost: 1 }},
  { name: "Darnell Washington", position: "TE", team: "PIT", projectedStats: { rec: 35, recYd: 386, recTD: 2, fumLost: 1 }},
  { name: "Brock Wright", position: "TE", team: "DET", projectedStats: { rec: 31, recYd: 281, recTD: 4 }},
  { name: "Charlie Kolar", position: "TE", team: "LAC", projectedStats: { rushYd: 1, rec: 25, recYd: 336, recTD: 4 }},
  { name: "Marlin Klein", position: "TE", team: "HOU", projectedStats: { rec: 35, recYd: 353, recTD: 2, fumLost: 1 }},
  { name: "Erick All", position: "TE", team: "CIN", projectedStats: { rec: 36, recYd: 303, recTD: 2 }},
  { name: "Daniel Bellinger", position: "TE", team: "TEN", projectedStats: { rec: 25, recYd: 317, recTD: 3 }},
  { name: "Ben Sims", position: "TE", team: "MIA", projectedStats: { rec: 32, recYd: 304, recTD: 2 }},
  { name: "Eli Stowers", position: "TE", team: "PHI", projectedStats: { rec: 31, recYd: 320, recTD: 2, fumLost: 1 }},
  { name: "Josh Oliver", position: "TE", team: "MIN", projectedStats: { rec: 22, recYd: 244, recTD: 4 }},
  { name: "Davis Allen", position: "TE", team: "LAR", projectedStats: { rec: 26, recYd: 239, recTD: 3 }},
  { name: "Tommy Tremble", position: "TE", team: "CAR", projectedStats: { rec: 29, recYd: 265, recTD: 2 }},
  { name: "Adam Trautman", position: "TE", team: "DEN", projectedStats: { rec: 27, recYd: 277, recTD: 2 }},
  { name: "Ja'Tavion Sanders", position: "TE", team: "CAR", projectedStats: { rec: 30, recYd: 233, recTD: 2 }},
  { name: "Luke Musgrave", position: "TE", team: "GB", projectedStats: { rec: 26, recYd: 261, recTD: 2 }},
  { name: "Austin Hooper", position: "TE", team: "ATL", projectedStats: { rec: 25, recYd: 286, recTD: 2 }},
  { name: "Jeremy Ruckert", position: "TE", team: "NYJ", projectedStats: { rec: 27, recYd: 195, recTD: 2 }},
  { name: "Grant Calcaterra", position: "TE", team: "PHI", projectedStats: { rec: 22, recYd: 227, recTD: 2 }},
  { name: "Cole Kmet", position: "TE", team: "CHI", projectedStats: { rushYd: 1, rec: 21, recYd: 218, recTD: 2 }},
  { name: "Eli Raridon", position: "TE", team: "NE", projectedStats: { rec: 22, recYd: 238, recTD: 2, fumLost: 1 }},
  { name: "Nate Boerkircher", position: "TE", team: "JAX", projectedStats: { rec: 21, recYd: 239, recTD: 2, fumLost: 1 }},
  { name: "John Bates", position: "TE", team: "WAS", projectedStats: { rec: 22, recYd: 214, recTD: 2, fumLost: 1 }},
  { name: "Matthew Hibner", position: "TE", team: "BAL", projectedStats: { rec: 16, recYd: 188, recTD: 2 }},
  { name: "Elijah Higgins", position: "TE", team: "ARI", projectedStats: { rec: 23, recYd: 209, recTD: 1, fumLost: 1 }},
  { name: "Nate Adkins", position: "TE", team: "DEN", projectedStats: { rec: 16, recYd: 111, recTD: 3 }},
  // ── K (CBS/SportsLine 2026, adjusted) ──
  { name: "Harrison Mevis", position: "K", team: "LAR", projectedStats: { fgMade: 29, fgMissed: 2, xpMade: 55, xpMissed: 1 }},
  { name: "Jake Bates", position: "K", team: "DET", projectedStats: { fgMade: 31, fgMissed: 7, xpMade: 53, xpMissed: 2 }},
  { name: "Jason Myers", position: "K", team: "SEA", projectedStats: { fgMade: 39, fgMissed: 5, xpMade: 50, xpMissed: 1 }},
  { name: "Spencer Shrader", position: "K", team: "IND", projectedStats: { fgMade: 34, fgMissed: 5, xpMade: 51, xpMissed: 2 }},
  { name: "Brandon Aubrey", position: "K", team: "DAL", projectedStats: { fgMade: 35, fgMissed: 5, xpMade: 49, xpMissed: 1 }},
  { name: "Nick Folk", position: "K", team: "ATL", projectedStats: { fgMade: 35, fgMissed: 3, xpMade: 47, xpMissed: 0 }},
  { name: "Cam Little", position: "K", team: "JAX", projectedStats: { fgMade: 28, fgMissed: 4, xpMade: 47, xpMissed: 1 }},
  { name: "Tyler Loop", position: "K", team: "BAL", projectedStats: { fgMade: 29, fgMissed: 3, xpMade: 49, xpMissed: 3 }},
  { name: "Cairo Santos", position: "K", team: "CHI", projectedStats: { fgMade: 32, fgMissed: 5, xpMade: 46, xpMissed: 1 }},
  { name: "Evan McPherson ", position: "K", team: "CIN", projectedStats: { fgMade: 30, fgMissed: 4, xpMade: 47, xpMissed: 3 }},
  { name: "Wil Lutz", position: "K", team: "DEN", projectedStats: { fgMade: 30, fgMissed: 6, xpMade: 44, xpMissed: 1 }},
  { name: "Tyler Bass", position: "K", team: "BUF", projectedStats: { fgMade: 26, fgMissed: 5, xpMade: 46, xpMissed: 3 }},
  { name: "Andres Borregales", position: "K", team: "NE", projectedStats: { fgMade: 27, fgMissed: 5, xpMade: 44, xpMissed: 1 }},
  { name: "Will Reichard", position: "K", team: "MIN", projectedStats: { fgMade: 33, fgMissed: 2, xpMade: 42, xpMissed: 0 }},
  { name: "Jake Moody", position: "K", team: "WAS", projectedStats: { fgMade: 28, fgMissed: 6, xpMade: 43, xpMissed: 2 }},
  { name: "Chase McLaughlin", position: "K", team: "TB", projectedStats: { fgMade: 33, fgMissed: 7, xpMade: 42, xpMissed: 1 }},
  { name: "Jake Elliott", position: "K", team: "PHI", projectedStats: { fgMade: 26, fgMissed: 7, xpMade: 41, xpMissed: 2 }},
  { name: "Ka'imi Fairbairn", position: "K", team: "HOU", projectedStats: { fgMade: 39, fgMissed: 4, xpMade: 40, xpMissed: 2 }},
  { name: "Cameron Dicker", position: "K", team: "LAC", projectedStats: { fgMade: 35, fgMissed: 4, xpMade: 39, xpMissed: 2 }},
  { name: "Charlie Smyth", position: "K", team: "NO", projectedStats: { fgMade: 30, fgMissed: 6, xpMade: 37, xpMissed: 1 }},
  { name: "Chad Ryland", position: "K", team: "ARI", projectedStats: { fgMade: 26, fgMissed: 7, xpMade: 37, xpMissed: 1 }},
  { name: "Chris Boswell", position: "K", team: "PIT", projectedStats: { fgMade: 26, fgMissed: 4, xpMade: 37, xpMissed: 1 }},
  { name: "Zane Gonzalez", position: "K", team: "MIA", projectedStats: { fgMade: 27, fgMissed: 4, xpMade: 37, xpMissed: 2 }},
  { name: "Trey Smack", position: "K", team: "GB", projectedStats: { fgMade: 28, fgMissed: 6, xpMade: 38, xpMissed: 5 }},
  { name: "Eddy Pineiro", position: "K", team: "SF", projectedStats: { fgMade: 31, fgMissed: 3, xpMade: 37, xpMissed: 4 }},
  { name: "Matt Gay", position: "K", team: "LV", projectedStats: { fgMade: 23, fgMissed: 8, xpMade: 33, xpMissed: 1 }},
  { name: "Jason Sanders", position: "K", team: "NYJ", projectedStats: { fgMade: 29, fgMissed: 5, xpMade: 35, xpMissed: 3 }},
  { name: "Harrison Butker", position: "K", team: "KC", projectedStats: { fgMade: 33, fgMissed: 6, xpMade: 35, xpMissed: 4 }},
  { name: "Joey Slye", position: "K", team: "TEN", projectedStats: { fgMade: 28, fgMissed: 5, xpMade: 32, xpMissed: 2 }},
  { name: "Ryan Fitzgerald", position: "K", team: "CAR", projectedStats: { fgMade: 22, fgMissed: 5, xpMade: 30, xpMissed: 3 }},
  // ── DEF (CBS/SportsLine 2026, adjusted) ──
  { name: "Houston Texans", position: "DEF", team: "HOU", projectedStats: { sacks: 56, ints: 16, fumRec: 14, defTD: 3, safety: 1, ptsAllowed: 316 }},
  { name: "Denver Broncos", position: "DEF", team: "DEN", projectedStats: { sacks: 73, ints: 15, fumRec: 10, defTD: 3, safety: 0, ptsAllowed: 310 }},
  { name: "Seattle Seahawks", position: "DEF", team: "SEA", projectedStats: { sacks: 51, ints: 14, fumRec: 12, defTD: 4, safety: 0, ptsAllowed: 299 }},
  { name: "Los Angeles Rams", position: "DEF", team: "LAR", projectedStats: { sacks: 52, ints: 15, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 345 }},
  { name: "Minnesota Vikings", position: "DEF", team: "MIN", projectedStats: { sacks: 61, ints: 13, fumRec: 16, defTD: 3, safety: 0, ptsAllowed: 359 }},
  { name: "Philadelphia Eagles", position: "DEF", team: "PHI", projectedStats: { sacks: 46, ints: 15, fumRec: 13, defTD: 3, safety: 0, ptsAllowed: 319 }},
  { name: "Detroit Lions", position: "DEF", team: "DET", projectedStats: { sacks: 59, ints: 14, fumRec: 10, defTD: 3, safety: 0, ptsAllowed: 398 }},
  { name: "Pittsburgh Steelers", position: "DEF", team: "PIT", projectedStats: { sacks: 50, ints: 13, fumRec: 17, defTD: 3, safety: 0, ptsAllowed: 361 }},
  { name: "Los Angeles Chargers", position: "DEF", team: "LAC", projectedStats: { sacks: 59, ints: 16, fumRec: 9, defTD: 3, safety: 0, ptsAllowed: 382 }},
  { name: "Buffalo Bills", position: "DEF", team: "BUF", projectedStats: { sacks: 46, ints: 16, fumRec: 11, defTD: 3, safety: 0, ptsAllowed: 396 }},
  { name: "Baltimore Ravens", position: "DEF", team: "BAL", projectedStats: { sacks: 50, ints: 14, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 376 }},
  { name: "Chicago Bears", position: "DEF", team: "CHI", projectedStats: { sacks: 44, ints: 16, fumRec: 13, defTD: 3, safety: 0, ptsAllowed: 393 }},
  { name: "Atlanta Falcons", position: "DEF", team: "ATL", projectedStats: { sacks: 66, ints: 15, fumRec: 10, defTD: 3, safety: 0, ptsAllowed: 416 }},
  { name: "New England Patriots", position: "DEF", team: "NE", projectedStats: { sacks: 44, ints: 13, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 365 }},
  { name: "Indianapolis Colts", position: "DEF", team: "IND", projectedStats: { sacks: 40, ints: 13, fumRec: 11, defTD: 3, safety: 0, ptsAllowed: 401 }},
  { name: "New Orleans Saints", position: "DEF", team: "NO", projectedStats: { sacks: 54, ints: 14, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 431 }},
  { name: "Green Bay Packers", position: "DEF", team: "GB", projectedStats: { sacks: 40, ints: 13, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 375 }},
  { name: "Kansas City Chiefs", position: "DEF", team: "KC", projectedStats: { sacks: 45, ints: 12, fumRec: 10, defTD: 2, safety: 0, ptsAllowed: 362 }},
  { name: "Jacksonville Jaguars", position: "DEF", team: "JAX", projectedStats: { sacks: 33, ints: 13, fumRec: 12, defTD: 4, safety: 0, ptsAllowed: 382 }},
  { name: "Cleveland Browns", position: "DEF", team: "CLE", projectedStats: { sacks: 55, ints: 14, fumRec: 11, defTD: 3, safety: 0, ptsAllowed: 406 }},
  { name: "Cincinnati Bengals", position: "DEF", team: "CIN", projectedStats: { sacks: 47, ints: 13, fumRec: 13, defTD: 3, safety: 0, ptsAllowed: 447 }},
  { name: "Miami Dolphins", position: "DEF", team: "MIA", projectedStats: { sacks: 52, ints: 10, fumRec: 13, defTD: 3, safety: 0, ptsAllowed: 474 }},
  { name: "Las Vegas Raiders", position: "DEF", team: "LV", projectedStats: { sacks: 46, ints: 11, fumRec: 13, defTD: 2, safety: 0, ptsAllowed: 474 }},
  { name: "Tampa Bay Buccaneers", position: "DEF", team: "TB", projectedStats: { sacks: 40, ints: 12, fumRec: 14, defTD: 3, safety: 0, ptsAllowed: 418 }},
  { name: "Washington Commanders", position: "DEF", team: "WAS", projectedStats: { sacks: 48, ints: 11, fumRec: 9, defTD: 3, safety: 0, ptsAllowed: 455 }},
  { name: "New York Giants", position: "DEF", team: "NYG", projectedStats: { sacks: 40, ints: 11, fumRec: 11, defTD: 3, safety: 0, ptsAllowed: 468 }},
  { name: "Carolina Panthers", position: "DEF", team: "CAR", projectedStats: { sacks: 43, ints: 13, fumRec: 9, defTD: 2, safety: 0, ptsAllowed: 421 }},
  { name: "Tennessee Titans", position: "DEF", team: "TEN", projectedStats: { sacks: 53, ints: 10, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 520 }},
  { name: "San Francisco 49ers", position: "DEF", team: "SF", projectedStats: { sacks: 33, ints: 11, fumRec: 12, defTD: 3, safety: 0, ptsAllowed: 409 }},
  { name: "Dallas Cowboys", position: "DEF", team: "DAL", projectedStats: { sacks: 44, ints: 9, fumRec: 11, defTD: 2, safety: 0, ptsAllowed: 497 }},
  { name: "Arizona Cardinals", position: "DEF", team: "ARI", projectedStats: { sacks: 35, ints: 12, fumRec: 12, defTD: 2, safety: 0, ptsAllowed: 520 }},
  { name: "New York Jets", position: "DEF", team: "NYJ", projectedStats: { sacks: 35, ints: 12, fumRec: 8, defTD: 3, safety: 0, ptsAllowed: 492 }},

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
    if (n >= 30) return json({ error: 'Rate limit — give it a moment.' }, 429, c);
    await env.RATE_KV.put(k, String(n + 1), { expirationTtl: 600 });
  }

  const provider = (env.LLM_PROVIDER || 'anthropic').toLowerCase();
  try {
    let upstream;
    if (provider === 'anthropic') {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': env.LLM_API_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: env.LLM_MODEL || 'claude-sonnet-4-6', max_tokens: 700, system, messages, stream: wantStream }),
      });
    } else {
      upstream = await fetch(env.LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.LLM_API_KEY },
        body: JSON.stringify({ model: env.LLM_MODEL || 'gpt-4o-mini', temperature: 0.4, max_tokens: 700, messages: [{ role: 'system', content: system }, ...messages], stream: wantStream }),
      });
    }
    if (!upstream.ok) { const j = await upstream.json().catch(() => ({})); return json({ error: (j.error && j.error.message) || ('Provider ' + upstream.status) }, 502, c); }
    if (wantStream) return streamResponse(upstream, provider, c);
    const j = await upstream.json();
    const text = provider === 'anthropic'
      ? (j.content && j.content[0] && j.content[0].text) || ''
      : (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    return json({ text }, 200, c);
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
