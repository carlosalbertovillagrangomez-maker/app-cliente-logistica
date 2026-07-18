import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// Tu configuración de Firebase
const firebaseConfig = {
  apiKey: "AIzaSyDCWNc2Lqh4Girn2PHU4Xiy9e-O2JCa8Gk",
  authDomain: "sistema-transporte-dec9d.firebaseapp.com",
  projectId: "sistema-transporte-dec9d",
  storageBucket: "sistema-transporte-dec9d.firebasestorage.app",
  messagingSenderId: "779301031888",
  appId: "1:779301031888:web:e70a41af33d02fad27b3d5"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db };