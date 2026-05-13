import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let projectId: string | undefined = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
let databaseId = "(default)";

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    projectId = projectId || config.projectId;
    if (config.firestoreDatabaseId) databaseId = config.firestoreDatabaseId;
  }
} catch (err) {
  console.warn("Could not read firebase-applet-config.json:", err);
}

// In local dev without service account file, it uses ADC (Application Default Credentials)
const appOptions: any = {
    projectId: projectId
};

console.log(`Firebase Admin: Initializing with Project: ${projectId || 'ADC'}, Database: ${databaseId}`);
const app = getApps().find(a => a.name === 'admin-app') || initializeApp(appOptions, 'admin-app');

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app, databaseId === '(default)' ? undefined : databaseId);
export const defaultDb = getFirestore(app);

export { projectId, databaseId };
