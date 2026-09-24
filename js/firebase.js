/* Firebase: sign-in and the database.
 *
 * The values below are not secrets. Google publishes them on purpose — they
 * identify the project, they don't grant access to it. What actually keeps
 * people out is firestore.rules, which checks the signed-in email against the
 * allow list. If you add or remove someone, change it in BOTH places:
 * firestore.rules and the MEMBERS map at the top of js/goals.js.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, addDoc,
         deleteDoc, onSnapshot, query, where, orderBy, limit }
  from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL,
         deleteObject }
  from "https://www.gstatic.com/firebasejs/12.18.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCFQ_3429pcInL1kLMfn3L2u_tByQT2nJ0",
  authDomain: "goal-tracker-v1-c9541.firebaseapp.com",
  projectId: "goal-tracker-v1-c9541",
  storageBucket: "goal-tracker-v1-c9541.firebasestorage.app",
  messagingSenderId: "1004737139972",
  appId: "1:1004737139972:web:dde5049c4c6034a6cb2c51",
  measurementId: "G-39TN7PM2G0"
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const fs   = getFirestore(app);
const st   = getStorage(app);

window.__FB = {
  signIn:  () => signInWithPopup(auth, new GoogleAuthProvider()),
  signOut: () => signOut(auth),
  onAuth:  (cb) => onAuthStateChanged(auth, cb),
  colRef:  (path) => collection(fs, ...path.split("/")),
  docRef:  (path) => doc(fs, ...path.split("/")),
  idToken: () => auth.currentUser ? auth.currentUser.getIdToken() : Promise.resolve(null),
  getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, onSnapshot,
  query, where, orderBy, limit,

  /* File attachments. Kept behind this object rather than imported directly in
     attachments.js so the tests can stand in for it, the same way they do for
     the database. */
  storage: {
    upload: (path, file, onProgress, meta) => new Promise((resolve, reject) => {
      const task = uploadBytesResumable(storageRef(st, path), file, meta || undefined);
      task.on("state_changed",
        (s) => { if (onProgress && s.totalBytes) onProgress(s.bytesTransferred / s.totalBytes); },
        reject,
        () => resolve());
    }),
    url:    (path) => getDownloadURL(storageRef(st, path)),
    remove: (path) => deleteObject(storageRef(st, path))
  }
};
window.dispatchEvent(new Event("fb-ready"));
