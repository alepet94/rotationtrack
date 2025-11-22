import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

const firebaseConfig = {
  "apiKey": "AIzaSyACaJFTODk0tQkLIW8ORm_mqIC1PHRBK8I",
  "authDomain": "rotation-pro.firebaseapp.com",
  "projectId": "rotation-pro",
  "storageBucket": "rotation-pro.firebasestorage.app",
  "messagingSenderId": "287422083702",
  "appId": "1:287422083702:web:cc63bf2a7bd2211c5fe557"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

export { app, auth, db, googleProvider };
