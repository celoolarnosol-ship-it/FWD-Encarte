import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
let databaseId = "(default)";

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  projectId = projectId || config.projectId;
  if (config.firestoreDatabaseId) databaseId = config.firestoreDatabaseId;
  
  console.log("Firebase Admin Initialized with Project:", projectId);
} catch (err) {
  console.warn("Could not read firebase-applet-config.json:", err);
}

const appOptions: any = {
    projectId: projectId
};

const app = getApps().length > 0 ? getApp() : initializeApp(appOptions);

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app, databaseId === '(default)' ? undefined : databaseId);

export { projectId };
