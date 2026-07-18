import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import {
  getMessaging,
  getToken,
  isSupported,
  onMessage
} from 'firebase/messaging';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

const firebaseConfig = {
  apiKey: 'AIzaSyDCWNc2Lqh4Girn2PHU4Xiy9e-O2JCa8Gk',
  authDomain: 'sistema-transporte-dec9d.firebaseapp.com',
  projectId: 'sistema-transporte-dec9d',
  storageBucket: 'sistema-transporte-dec9d.firebasestorage.app',
  messagingSenderId: '779301031888',
  appId: '1:779301031888:web:e70a41af33d02fad27b3d5'
};

const VAPID_KEY = 'RfcfCzSCQyC5wI1obDI4iGhE9HSjHRGxE_5sy0di42s';
const CHANNEL_ID = 'triplogix_client_alerts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

let nativeTokenCache = '';
let webMessagingCache = null;

const isNativeApp = () => Capacitor.isNativePlatform();

const createAndroidNotificationChannel = async () => {
  if (!isNativeApp() || Capacitor.getPlatform() !== 'android') return;

  try {
    await PushNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Alertas TripLogix Cliente',
      description: 'Conductor asignado, viaje iniciado, proximidad y finalización.',
      importance: 5,
      visibility: 1,
      vibration: true
    });
  } catch (error) {
    console.warn('No se pudo crear el canal de notificaciones:', error);
  }
};

const getWebMessaging = async () => {
  if (typeof window === 'undefined') return null;
  if (!(await isSupported())) return null;

  if (!webMessagingCache) {
    webMessagingCache = getMessaging(app);
  }

  return webMessagingCache;
};

const requestWebToken = async () => {
  if (typeof window === 'undefined' || !('Notification' in window)) return null;

  let permission = Notification.permission;
  if (permission === 'default') permission = await Notification.requestPermission();
  if (permission !== 'granted') return null;

  const messaging = await getWebMessaging();
  if (!messaging) return null;

  let serviceWorkerRegistration;
  if ('serviceWorker' in navigator) {
    serviceWorkerRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  }

  return getToken(messaging, {
    vapidKey: VAPID_KEY,
    serviceWorkerRegistration
  });
};

export const setupPushNotifications = async ({
  onToken,
  onNotification,
  onAction
} = {}) => {
  const cleanupHandles = [];

  if (isNativeApp()) {
    await createAndroidNotificationChannel();

    cleanupHandles.push(
      await PushNotifications.addListener('registration', (token) => {
        nativeTokenCache = token.value || '';
        onToken?.(nativeTokenCache);
      })
    );

    cleanupHandles.push(
      await PushNotifications.addListener('registrationError', (error) => {
        console.error('Error registrando notificaciones:', error);
      })
    );

    cleanupHandles.push(
      await PushNotifications.addListener('pushNotificationReceived', (notification) => {
        onNotification?.(notification);
      })
    );

    cleanupHandles.push(
      await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
        onAction?.(action);
      })
    );

    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt') {
      permission = await PushNotifications.requestPermissions();
    }

    if (permission.receive === 'granted') {
      await PushNotifications.register();
    }

    return async () => {
      await Promise.all(
        cleanupHandles.map((handle) => handle?.remove?.().catch(() => {}))
      );
    };
  }

  const token = await requestWebToken();
  if (token) onToken?.(token);

  const messaging = await getWebMessaging();
  if (messaging) {
    const unsubscribe = onMessage(messaging, (payload) => {
      onNotification?.(payload);
    });

    return async () => unsubscribe?.();
  }

  return async () => {};
};
