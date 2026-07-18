/* global importScripts, firebase */
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyDCWNc2Lqh4Girn2PHU4Xiy9e-O2JCa8Gk',
  authDomain: 'sistema-transporte-dec9d.firebaseapp.com',
  projectId: 'sistema-transporte-dec9d',
  storageBucket: 'sistema-transporte-dec9d.firebasestorage.app',
  messagingSenderId: '779301031888',
  appId: '1:779301031888:web:e70a41af33d02fad27b3d5'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload?.notification?.title || payload?.data?.title || 'TripLogix Cliente';
  const body = payload?.notification?.body || payload?.data?.body || 'Tu viaje tiene una actualización.';
  const tripId = payload?.data?.tripId || '';

  self.registration.showNotification(title, {
    body,
    icon: '/logo.png',
    badge: '/logo.png',
    tag: tripId ? `triplogix-client-${tripId}` : 'triplogix-client',
    data: {
      url: tripId ? `/?trip=${encodeURIComponent(tripId)}` : '/'
    }
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification?.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
