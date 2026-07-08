// ─────────────────────────────────────────────────────────────────────────────
//  regions.js  –  Which regional server handles each country button
// ─────────────────────────────────────────────────────────────────────────────
//
//  Copy this to regions.js and fill in the real values for each regional
//  server you've set up with setup.sh. The keys here (speed_ger, etc.) must
//  match the callback_data values used in main.js's country menu.
//
//  Where to get each value:
//    domain     - the domain you gave that region's setup.sh
//    adminPort  - the "Admin API port" from that region's setup.sh banner
//    adminToken - the "Bearer Token" from that region's setup.sh banner
//
//  Only add an entry once that region's server actually exists — main.js
//  will tell the customer "temporarily unavailable" for any country whose
//  key is missing here, rather than crashing.
//
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    speed_ger: {
        name: 'Germany',
        domain: 'de.de01dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_GERMANY_SERVER_ADMIN_TOKEN_HERE'
    },
    speed_sweden: {
        name: 'Sweden',
        domain: 'se.se01dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_SWEDEN_SERVER_ADMIN_TOKEN_HERE'
    },
    speed_fin: {
        name: 'Finland',
        domain: 'fi.fi01dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_FINLAND_SERVER_ADMIN_TOKEN_HERE'
    },
    speed_it: {
        name: 'Italy',
        domain: 'it.it01dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_ITALY_SERVER_ADMIN_TOKEN_HERE'
    },
    speed_in: {
        name: 'India',
        domain: 'in.in01dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_INDIA_SERVER_ADMIN_TOKEN_HERE'
    },
    speed_uae: {
        name: 'UAE',
        domain: 'ae.ae01dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_UAE_SERVER_ADMIN_TOKEN_HERE'
    },
    speed_uk: {
        name: 'UK',
        domain: 'uk.uk01dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_UK_SERVER_ADMIN_TOKEN_HERE'
    },
    speed_usa: {
        name: 'USA',
        domain: 'us.us08dir.mithracorp.com',
        adminPort: 9443,
        adminToken: 'PASTE_USA_SERVER_ADMIN_TOKEN_HERE'
    }
};
