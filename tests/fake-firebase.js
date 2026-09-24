(() => {
  const store = {}; const listeners = [];
  const notify = () => listeners.slice().forEach(f => f());
  const mkDoc = (p) => ({ id: p.split('/').pop(), exists: () => p in store, data: () => store[p] });
  const keysIn = (col) => Object.keys(store)
    .filter(k => k.startsWith(col + '/') && k.slice(col.length + 1).indexOf('/') === -1);
  function runQuery(q) {
    let keys = keysIn(q.col);
    for (const c of q.cons) {
      if (c.k === 'where') keys = keys.filter(k => {
        const v = store[k][c.f];
        if (c.op === '==') return v === c.v;
        if (c.op === '!=') return v !== c.v;
        if (c.op === '>=') return v >= c.v;
        if (c.op === '<=') return v <= c.v;
        return true;
      });
      else if (c.k === 'orderBy') keys.sort((a, b) => {
        const x = store[a][c.f], y = store[b][c.f];
        const r = x === y ? 0 : (x > y ? 1 : -1);
        return c.dir === 'desc' ? -r : r;
      });
      else if (c.k === 'limit') keys = keys.slice(0, c.n);
    }
    return { docs: keys.map(mkDoc), forEach: (f) => keys.forEach(k => f(mkDoc(k))) };
  }
  let seq = 0;
  window.__STORE = store;
  window.__FILES = {};
  window.__URL_CALLS = [];
  window.__FB = {
    signIn: () => { window.__cb({ email: window.__EMAIL || 'samuelgibby89@gmail.com',
                                 displayName: window.__NAME || 'Samuel Gibby', photoURL: '' }); return Promise.resolve(); },
    signOut: () => { window.__cb(null); return Promise.resolve(); },
    idToken: () => Promise.resolve('fake.jwt.token'),
    storage: {
      upload: (path, file, onProgress, meta) => new Promise((resolve, reject) => {
        if (window.__FAIL_UPLOAD) return reject({ code: 'storage/unauthorized' });
        if (onProgress) { onProgress(0.4); onProgress(1); }
        const fr = new FileReader();
        fr.onload = () => {
          window.__FILES[path] = { size: file.size, type: file.type,
                                   meta: meta || null, bytes: fr.result.byteLength };
          resolve();
        };
        fr.onerror = () => reject({ code: 'storage/unknown' });
        fr.readAsArrayBuffer(file);
      }),
      /* A blob: URL rather than a real firebasestorage.googleapis.com one — the
         test browser can't reach the internet, and a URL that fails to load
         navigates the app away and hides what we're actually testing. The path
         asked for is recorded so tests can assert on it. */
      url: (path) => {
        if (!(path in window.__FILES)) return Promise.reject({ code: 'storage/object-not-found' });
        window.__URL_CALLS.push(path);
        const f = window.__FILES[path];
        return Promise.resolve(URL.createObjectURL(
          new Blob([new Uint8Array(f.bytes || 1)], { type: f.type || 'application/octet-stream' })));
      },
      remove: (path) => {
        if (!(path in window.__FILES)) return Promise.reject({ code: 'storage/object-not-found' });
        delete window.__FILES[path];
        return Promise.resolve();
      }
    },
    onAuth: (cb) => { window.__cb = cb; setTimeout(() => cb(null), 0); },
    colRef: (p) => ({ __col: p }),
    docRef: (p) => ({ __doc: p }),
    query: (ref, ...cons) => ({ col: ref.__col, cons }),
    where: (f, op, v) => ({ k: 'where', f, op, v }),
    orderBy: (f, dir) => ({ k: 'orderBy', f, dir }),
    limit: (n) => ({ k: 'limit', n }),
    getDoc: (r) => Promise.resolve(mkDoc(r.__doc)),
    getDocs: (q) => Promise.resolve(runQuery(q.col ? q : { col: q.__col, cons: [] })),
    setDoc: (r, d) => { store[r.__doc] = JSON.parse(JSON.stringify(d)); notify(); return Promise.resolve(); },
    updateDoc: (r, d) => { store[r.__doc] = Object.assign({}, store[r.__doc], JSON.parse(JSON.stringify(d))); notify(); return Promise.resolve(); },
    addDoc: (ref, d) => { const id = 'x' + (++seq); store[ref.__col + '/' + id] = JSON.parse(JSON.stringify(d)); notify(); return Promise.resolve({ id }); },
    deleteDoc: (r) => { delete store[r.__doc]; notify(); return Promise.resolve(); },
    onSnapshot: (target, next) => {
      const fire = () => {
        if (target.__doc) next(mkDoc(target.__doc));
        else next(runQuery(target.col ? target : { col: target.__col, cons: [] }));
      };
      listeners.push(fire); setTimeout(fire, 0);
      return () => { const i = listeners.indexOf(fire); if (i >= 0) listeners.splice(i, 1); };
    }
  };
})();