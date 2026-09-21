// DHF Desk — runtime configuration.
//
// Loaded before every app script (index.html, staff.html, portal.html,
// crm.html). Nothing in here is a secret: the Supabase key is the public
// publishable key (row-level security is what protects the data), and the
// Google client ID and Maps key are visible in any browser anyway.
//
// These values are PRODUCTION. Non-production deploys overwrite this file at
// build time — see scripts/build-config.mjs and netlify.toml. Local
// development can edit this file, but don't commit that change: pointing a
// local copy at production means every click writes real DHF data.
window.DHF_CONFIG = {
  // 'production' | 'staging' | 'preview' | 'local'
  env: 'production',

  supabaseUrl: 'https://cztpumgrvhmcvvpqbfqo.supabase.co',
  supabaseKey: 'sb_publishable_uj8jlFriz9gRP-eo2vZEZA_u_qIhub3',

  googleClientId: '992833623399-s28cqha40ho2f4s2mvihskiicngb3g5e.apps.googleusercontent.com',
  mapsKey: 'AIzaSyCOX5HVSFPX_4ktHAZA_wtWrw5WwQLn38s',

  // Cosmetic only: the database (RLS) is what actually decides who is staff.
  // Kept here so non-production environments can use their own test accounts.
  allowedDomain: 'dhftyres.com.au',
  allowedEmails: ['dushentissera@gmail.com']
};
