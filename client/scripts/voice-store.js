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
    // v2 adds ChatHistoryStore.STORE_NAME ('messages') to this same database
    // - see ChatHistoryStore below. Both stores live together because both
    // are "client-only, never persisted server-side" data for the same
    // per-peer chat thread.
    static DB_VERSION = 2;

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
                if (!db.objectStoreNames.contains(ChatHistoryStore.STORE_NAME)) {
                    const store = db.createObjectStore(ChatHistoryStore.STORE_NAME, { keyPath: 'id' });
                    store.createIndex('peerId', 'peerId', { unique: false });
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

/**
 * IndexedDB-backed store for per-peer chat history (text + voice message
 * *metadata* - voice audio bytes themselves stay in VoiceStore.audios,
 * keyed by the same id, so a history row never duplicates the blob).
 *
 * Shares VoiceStore's database (see DB_VERSION above) rather than opening
 * a second connection - both stores answer to the same constraint from the
 * design discussion: this is client-local convenience data, not something
 * the signaling/relay server ever sees or stores.
 *
 * Known limitation (accepted as "path A", see chat history): peerId is a
 * server-issued session id with no stable identity across a browser
 * restart (server hands out a fresh one once the signaling cookie is
 * gone). History keyed by peerId survives page reloads/dialog reopens for
 * as long as that session id stays valid, but a peer that restarts their
 * browser shows up as a new, historyless peerId - there is no
 * cross-restart "contact" concept in this app to reconcile against.
 */
class ChatHistoryStore {

    static STORE_NAME = 'messages';

    static _openDB() {
        return VoiceStore._openDB();
    }

    /**
     * Write-through upsert, called from ui.js SendTextDialog#_upsert on
     * every message create/status transition (sending/delivered/failed).
     * Last write wins per id, same as the in-memory thread it mirrors.
     * @param {string} peerId
     * @param {{id:string, type?:'text'|'voice', text?:string,
     *   duration?:number, direction:'incoming'|'outgoing', status:string,
     *   timestamp:number}} message
     */
    static async put(peerId, message) {
        if (!peerId || !message || !message.id) return;
        const db = await ChatHistoryStore._openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(ChatHistoryStore.STORE_NAME, 'readwrite');
            tx.objectStore(ChatHistoryStore.STORE_NAME).put({
                id: message.id,
                peerId,
                type: message.type || 'text',
                text: message.text,
                duration: message.duration,
                direction: message.direction,
                status: message.status,
                timestamp: message.timestamp || Date.now()
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    /**
     * @param {string} peerId
     * @returns {Promise<Array>} this peer's thread, oldest first. Resolves
     *   to [] (never rejects) on any storage error - history is a nicety,
     *   not something that should block opening the chat dialog.
     */
    static async getThread(peerId) {
        let db;
        try {
            db = await ChatHistoryStore._openDB();
        } catch (e) {
            return [];
        }
        return new Promise((resolve) => {
            const tx = db.transaction(ChatHistoryStore.STORE_NAME, 'readonly');
            const index = tx.objectStore(ChatHistoryStore.STORE_NAME).index('peerId');
            const req = index.getAll(peerId);
            req.onsuccess = () => {
                const rows = req.result || [];
                rows.sort((a, b) => a.timestamp - b.timestamp);
                resolve(rows);
            };
            req.onerror = () => resolve([]);
        });
    }

    /**
     * Mirrors VoiceStore.pruneOlderThan with the same default window, so
     * text history and voice audio age out together instead of history
     * outliving the audio it references (or vice versa). Called once at
     * startup (see ui.js).
     */
    static async pruneOlderThan(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
        let db;
        try {
            db = await ChatHistoryStore._openDB();
        } catch (e) {
            return;
        }
        const cutoff = Date.now() - maxAgeMs;
        return new Promise((resolve) => {
            const tx = db.transaction(ChatHistoryStore.STORE_NAME, 'readwrite');
            const store = tx.objectStore(ChatHistoryStore.STORE_NAME);
            const req = store.openCursor();
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return;
                if (cursor.value.timestamp < cutoff) cursor.delete();
                cursor.continue();
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
        });
    }
}

window.VoiceStore = VoiceStore;
window.ChatHistoryStore = ChatHistoryStore;
