import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';

let projectId: string | undefined = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
let databaseId = (process.env.FIRESTORE_DB_ID || process.env.VITE_FIRESTORE_DB_ID || '').trim();

function isDefaultId(id: string) {
  return !id || id === '(default)' || id === 'default';
}

try {
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    console.log(`[Firebase Admin] Found config file at ${configPath}`);
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log(`[Firebase Admin] Config contents: ${JSON.stringify({ projectId: config.projectId, firestoreDatabaseId: config.firestoreDatabaseId })}`);
// Use the PROJECT ID from environment if available (ADC usually needs this), otherwise fallback to config
const envProjectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
if (envProjectId) {
  projectId = envProjectId;
  console.log(`[Firebase Admin] Using Project ID from Environment: "${projectId}"`);
} else if (config.projectId) {
  projectId = config.projectId;
  console.log(`[Firebase Admin] Using Project ID from config: "${projectId}"`);
}

// Always prefer the named database from config if the env is missing or a default placeholder
if (config.firestoreDatabaseId && isDefaultId(databaseId)) {
    console.log(`[Firebase Admin] Overriding databaseId with config: ${config.firestoreDatabaseId}`);
    databaseId = config.firestoreDatabaseId;
}
  } else {
    console.warn(`[Firebase Admin] Config file NOT found at ${configPath}. Current CWD: ${process.cwd()}`);
  }
} catch (err) {
  console.warn("Could not read firebase-applet-config.json:", err);
}

// Final fallback
if (isDefaultId(databaseId)) databaseId = "(default)";

console.log(`[Firebase Admin] DEBUG Environment: PROJECT="${process.env.GOOGLE_CLOUD_PROJECT || 'N/A'}", DB_ID="${process.env.FIRESTORE_DB_ID || 'N/A'}"`);
console.log(`[Firebase Admin] Final Config: Project="${projectId || 'AUTO'}", Database="${databaseId}"`);

// Always prefer providing a projectId to ensure ADC targets the correct project,
// especially in shared environments.
const appOptions: any = {};
if (projectId) {
    appOptions.projectId = projectId;
}

// Use a unique name if multiple initializations occur, or use the default app
const app = getApps().length > 0 ? getApp() : initializeApp(appOptions);

export const adminAuth = getAuth(app);
// Use the specific database if provided, otherwise default
export const adminDb = getFirestore(app, isDefaultId(databaseId) ? undefined : databaseId);
export const defaultDb = getFirestore(app);

export { projectId, databaseId };
