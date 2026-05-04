import { adminStorage } from "./src/lib/firebase/admin.js";
async function test() {
    try {
        const bucket = adminStorage.bucket();
        const [files] = await bucket.getFiles({ prefix: 'admin/knowledge-base/' });
        console.log("Success! Files:", files.length);
    } catch (e) {
        console.error("Storage Admin Error:", e);
    }
}
test();
