import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';
import path from 'path';

// Since we are running on Google Cloud Run natively in AI Studio, Application Default Credentials (ADC) are sufficient for firebase-admin,
// or we can use the injected configuration from environment but AI Studio does not inject firebase-admin credentials automatically.
// Wait! If ai-studio provides firebase setup, how do we use firebase-admin?
// The recommended way is to just call `initializeApp()` which uses ADC (Application Default Credentials).
let projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
let databaseId = "(default)";
let storageBucket = undefined;
try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  projectId = projectId || config.projectId;
  if (config.firestoreDatabaseId) databaseId = config.firestoreDatabaseId;
  if (config.storageBucket) storageBucket = config.storageBucket;
  
  console.log("Firebase Admin Initialized with Project:", projectId, "StorageBucket:", storageBucket);
} catch (err) {
  console.warn("Could not read firebase-applet-config.json");
}

const app = getApps().length > 0 ? getApp() : initializeApp({
    projectId: projectId,
    storageBucket: storageBucket
});

export const adminDb = getFirestore(app, databaseId);
export const adminAuth = getAuth(app);
export const adminStorage = getStorage(app);
