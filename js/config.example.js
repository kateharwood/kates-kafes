// Copy this file to config.js and add your Google Maps API key.
// config.js is gitignored so your key stays local.

window.KATES_KAFES_CONFIG = {
  // Get a key: https://console.cloud.google.com/google/maps-apis
  // Enable "Maps JavaScript API". Restrict to your domain in production.
  GOOGLE_MAPS_API_KEY: "YOUR_API_KEY_HERE",

  // Optional: published Google Sheet CSV URL (see SETUP.md).
  // When set, the map loads live data from your sheet instead of data/cafes.json.
  SHEET_CSV_URL: "",

  // Home base for reference (7th Ave & 2nd St, Park Slope)
  HOME: { lat: 40.6706039, lng: -73.9782784 },
};
