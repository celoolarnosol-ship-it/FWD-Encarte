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

// Only add storageBucket if it's explicitly provided
if (storageBucket) {
  appOptions.storageBucket = storageBucket;
}

const app = getApps().length > 0 ? getApp() : initializeApp(appOptions);

export const adminAuth = getAuth(app);
export const adminDb = getFirestore(app, databaseId === '(default)' ? undefined : databaseId);

// Smarter bucket resolution
const storage = getStorage(app);
let bucketInstance = storage.bucket();

// Helper to determine the best bucket
export const getActiveBucket = async () => {
    // 1. Try default bucket
    try {
        const [exists] = await bucketInstance.exists();
        if (exists) return bucketInstance;
    } catch (e: any) {
        console.warn(`[Firebase Storage] Default bucket ${bucketInstance.name} exists check failed:`, e.message);
    }

    // 2. Try to list buckets to find a valid one (most reliable if permissions allow)
    try {
        const [buckets] = await storage.getBuckets();
        if (buckets && buckets.length > 0) {
            console.log(`[Firebase Storage] Found ${buckets.length} buckets in project: ${buckets.map(b => b.name).join(', ')}`);
            bucketInstance = buckets[0];
            return bucketInstance;
        }
    } catch (e: any) {
        console.warn(`[Firebase Storage] Failed to list buckets (this is expected if permissions are limited):`, e.message);
    }

    // 3. Try common fallbacks if we have a project ID
    if (projectId) {
        const guesses = [
            `${projectId}.appspot.com`,
            `${projectId}.firebasestorage.app`,
            projectId
        ];

        for (const name of guesses) {
            if (name === bucketInstance.name) continue; // Already tried
            try {
                console.log(`[Firebase Storage] Testing bucket guess: ${name}`);
                const b = storage.bucket(name);
                const [exists] = await b.exists();
                if (exists) {
                    console.info(`[Firebase Storage] Found valid bucket via guess: ${name}`);
                    bucketInstance = b;
                    return bucketInstance;
                }
            } catch (e: any) {
                console.warn(`[Firebase Storage] Guess ${name} failed:`, e.message);
            }
        }
    }

    return bucketInstance;
};

export { projectId };
