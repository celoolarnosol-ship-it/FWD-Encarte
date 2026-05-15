import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let projectId: string | undefined = process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
let databaseId = (process.env.FIRESTORE_DB_ID || process.env.VITE_FIRESTORE_DB_ID || '').trim();

function isDefaultId(id: string) {
  return !id || id === '(default)' || id === 'default';
}

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    projectId = projectId || config.projectId;
    // Always prefer the named database from config if the env is missing or a default placeholder
    if (config.firestoreDatabaseId && isDefaultId(databaseId)) {
        console.log(`[Firebase Admin] Using database from config: ${config.firestoreDatabaseId}`);
        databaseId = config.firestoreDatabaseId;
    }
  }
} catch (err) {
  console.warn("Could not read firebase-applet-config.json:", err);
}

// Final fallback
if (isDefaultId(databaseId)) databaseId = "(default)";

console.log(`[Firebase Admin] Final Database ID: "${databaseId}"`);

// In local dev without service account file, it uses ADC (Application Default Credentials)
const appOptions: any = {
    projectId: projectId
};

console.log(`Firebase Admin: Initializing with Project: ${projectId || 'ADC'}, Database: ${databaseId}`);
const app = getApps().find(a => a.name === 'admin-app') || initializeApp(appOptions, 'admin-app');

export const adminAuth = getAuth(app);
// Use the specific database if provided, otherwise default
export const adminDb = getFirestore(app, isDefaultId(databaseId) ? undefined : databaseId);
export const defaultDb = getFirestore(app);

export { projectId, databaseId };
