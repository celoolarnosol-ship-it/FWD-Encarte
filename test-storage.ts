
import { initializeApp } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';
import fs from 'fs';
import path from 'path';

async function test() {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const firestoreId = config.firestoreDatabaseId;

    if (!firestoreId) {
        console.log("No firestoreDatabaseId found");
        return;
    }

    console.log("Testing with firestoreId:", firestoreId);
    try {
        const app = initializeApp({ projectId: config.projectId });
        const storage = getStorage(app);
        const bucket = storage.bucket(`${firestoreId}.appspot.com`);
        console.log("Testing bucket:", bucket.name);
        await bucket.getMetadata();
        console.log("SUCCESS");
    } catch (e) {
        console.log("FAILED:", e.message);
    }
}

test().catch(console.error);
