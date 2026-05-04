import { adminDb } from "./src/lib/firebase/admin.js";
async function test() {
    try {
        const doc = await adminDb.collection("users").doc("test").get();
        console.log("Success! doc exists:", doc.exists);
    } catch (e) {
        console.error("Firestore Admin Error:", e);
    }
}
test();
