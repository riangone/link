/**
 * IndexedDB-backed store for voice-message audio blobs.
 *
 * Design constraint driving this file (see chat history): voice messages
 * travel peer-to-peer over the same WebRTC data channel / WSPeer relay used
 * for file transfers (network.js Peer#sendVoice), and the signaling/relay
 * server never persists the audio - it only ever sees bytes in flight. The
 * durable copy of a voice message lives exclusively in each participant's
 * own browser, in this store. That means:
 *   - the sender writes its own copy here as soon as recording finishes,
 *     independent of whether the send actually succeeds
 *   - the receiver writes its copy here once FileDigester finishes
 *     reassembling the incoming chunks (see Peer#_onFileReceived)
 *   - if either side clears site data or opens the chat on another device,
 *     that copy is gone for good - the message list keeps a "voice message"
 *     placeholder (network.js voice-message event) but playback becomes
 *     unavailable. ui.js renders that as a disabled bubble.
 */
class VoiceStore {

    static DB_NAME = 'link-voice-messages';
    static STORE_NAME = 'audios';
    static DB_VERSION = 1;

    static _dbPromise = null;

    static _openDB() {
        if (VoiceStore._dbPromise) return VoiceStore._dbPromise;
        VoiceStore._dbPromise = new Promise((resolve, reject) => {
            if (!window.indexedDB) {
                reject(new Error('VoiceStore: IndexedDB not supported'));
                return;
            }
            const req = indexedDB.open(VoiceStore.DB_NAME, VoiceStore.DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(VoiceStore.STORE_NAME)) {
                    db.createObjectStore(VoiceStore.STORE_NAME, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return VoiceStore._dbPromise;
    }

    /**
     * @param {string} id - transferId, same id used across the
     *   'voice-message' events fired in network.js, so playback can be
     *   looked up by the same id the chat thread renders.
     * @param {Blob} blob - recorded/received audio
     * @param {{duration:number, peerId:string, direction:'incoming'|'outgoing'}} meta
     */
    static async put(id, blob, meta) {
        const db = await VoiceStore._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VoiceStore.STORE_NAME, 'readwrite');
            tx.objectStore(VoiceStore.STORE_NAME).put({
                id,
                blob,
                duration: meta.duration,
                peerId: meta.peerId,
                direction: meta.direction,
                createdAt: Date.now()
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /** @returns {Promise<{id:string, blob:Blob, duration:number, peerId:string, direction:string, createdAt:number}|null>} */
    static async get(id) {
        const db = await VoiceStore._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VoiceStore.STORE_NAME, 'readonly');
            const req = tx.objectStore(VoiceStore.STORE_NAME).get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    }

    static async delete(id) {
        const db = await VoiceStore._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(VoiceStore.STORE_NAME, 'readwrite');
            tx.objectStore(VoiceStore.STORE_NAME).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * Best-effort cleanup so a long-lived browser profile doesn't grow this
     * store forever. Voice messages are ephemeral chat content, not a
     * permanent archive - mirrors the "server never stores it long-term"
     * rule on the client side. Called once at startup (see ui.js).
     */
    static async pruneOlderThan(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
        let db;
        try {
            db = await VoiceStore._openDB();
        } catch (e) {
            return; // IndexedDB unavailable - nothing to prune
        }
        const cutoff = Date.now() - maxAgeMs;
        return new Promise((resolve) => {
            const tx = db.transaction(VoiceStore.STORE_NAME, 'readwrite');
            const store = tx.objectStore(VoiceStore.STORE_NAME);
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return;
                if (cursor.value.createdAt < cutoff) cursor.delete();
                cursor.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve(); // best-effort, don't surface errors
        });
    }
}

window.VoiceStore = VoiceStore;
