// AOSS Talents — site configuration.
// Fill `firebase` with the web app config from Firebase console
// (Project settings → Your apps → Web app). Leave it null to run in demo mode
// (data stays in this browser only).
export const CONFIG = {
  // Public web config (safe to ship; access is enforced by firestore.rules).
  firebase: {
    apiKey: 'AIzaSyCesVhtw0fR-YEfAIr4RyP9INKWNzFQYDE',
    authDomain: 'aoss-talents.firebaseapp.com',
    projectId: 'aoss-talents',
    storageBucket: 'aoss-talents.firebasestorage.app',
    messagingSenderId: '698114141608',
    appId: '1:698114141608:web:91b1efb5c432ef7fdf819d',
  },
  // Emails allowed to approve talents in admin.html
  admins: ['info@aoss.media'],
  // AOSS store and contact
  storeUrl: 'https://aoss.shop',
  whatsapp: '966578648331',
  brand: 'AOSS MEDIA',
};
