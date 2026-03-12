import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDyijnox-MMjZTefC3LpT-KApfcU6uev8g",
  authDomain: "sersale-produccion.firebaseapp.com",
  projectId: "sersale-produccion",
  storageBucket: "sersale-produccion.firebasestorage.app",
  messagingSenderId: "925974326060",
  appId: "1:925974326060:web:12143f2ebb812d19dfda89"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
