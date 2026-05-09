import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';
import path from 'path';

let projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
let databaseId = "(default)";
let storageBucket = undefined;

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  projectId = projectId || config.projectId;
  if (config.firestoreDatabaseId) databaseId = config.firestoreDatabaseId;
  
  if (config.storageBucket) {
    storageBucket = config.storageBucket;
  } else {
    storageBucket = `${projectId}.appspot.com`;
  }
  
  // LOG THE ATTEMPTED BUCKET
  console.log("Firebase Admin Initialized with Project:", projectId, "StorageBucket:", storageBucket);
} catch (err) {
  console.warn("Could not read firebase-applet-config.json:", err);
  if (projectId) storageBucket = `${projectId}.appspot.com`;
}

// Fallback to project ID if bucket is still not set
if (!storageBucket && projectId) {
    storageBucket = `${projectId}.appspot.com`;
}

const appOptions: any = {
    projectId: projectId
};

// Only add storageBucket if it's explicitly provided and not just the default guess
if (storageBucket && !storageBucket.includes('firebasestorage.app')) {
  appOptions.storageBucket = storageBucket;
}

const app = getApps().length > 0 ? getApp() : initializeApp(appOptions);

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app);
export const adminBucket = getStorage(app).bucket(storageBucket); // Use the guess or config value
export { projectId };
