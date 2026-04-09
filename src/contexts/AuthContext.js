import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase/config';

const AuthContext = createContext(null);

const profileCacheKey = (uid) => `pos:user-profile:${uid}`;
const normalizeRole = (role) => (role === 'inventory' ? 'manager' : role);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const stopLoading = () => {
      if (isMounted) setLoading(false);
    };

    const loadProfile = async (firebaseUser) => {
      const adminEmails = (process.env.REACT_APP_ADMIN_EMAILS || '')
        .split(',')
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      const isAdminEmail = adminEmails.includes((firebaseUser.email || '').toLowerCase());

      const fallbackProfile = {
        id: firebaseUser.uid,
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        name: firebaseUser.displayName || 'Usuario',
        role: isAdminEmail ? 'admin' : 'cashier',
        status: 'active'
      };

      try {
        // Carga instantanea desde cache local para evitar pantalla de espera larga.
        const cached = localStorage.getItem(profileCacheKey(firebaseUser.uid));
        if (cached && isMounted) {
          const parsedCached = JSON.parse(cached);
          parsedCached.role = normalizeRole(parsedCached.role);
          setProfile(parsedCached);
        }

        const userRef = doc(db, 'users', firebaseUser.uid);
        const snap = await getDoc(userRef);

        if (snap.exists()) {
          const firestoreProfile = { id: snap.id, ...snap.data() };
          firestoreProfile.role = normalizeRole(firestoreProfile.role);

          // Si el email está marcado como admin en .env, elevamos rol localmente siempre.
          // Intentamos persistir en Firestore, pero si reglas lo bloquean, no rompemos el acceso admin.
          if (isAdminEmail) {
            firestoreProfile.role = 'admin';
            try {
              await setDoc(
                userRef,
                {
                  role: 'admin',
                  status: firestoreProfile.status || 'active',
                  updatedAt: serverTimestamp()
                },
                { merge: true }
              );
            } catch (persistError) {
              console.warn('No se pudo persistir rol admin en Firestore, se aplicara localmente.', persistError);
            }
          } else if (snap.data()?.role === 'inventory') {
            try {
              await setDoc(
                userRef,
                {
                  role: 'manager',
                  updatedAt: serverTimestamp()
                },
                { merge: true }
              );
            } catch (persistError) {
              console.warn('No se pudo migrar rol inventory a manager en Firestore.', persistError);
            }
          }

          if (!isMounted) return;
          setProfile(firestoreProfile);
          localStorage.setItem(profileCacheKey(firebaseUser.uid), JSON.stringify(firestoreProfile));
          return;
        }
        const bootstrapProfile = {
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          name: firebaseUser.displayName || 'Usuario',
          role: isAdminEmail ? 'admin' : 'cashier',
          status: 'active',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

        await setDoc(userRef, bootstrapProfile, { merge: true });
        if (!isMounted) return;
        const bootstrapped = { id: firebaseUser.uid, ...bootstrapProfile };
        setProfile(bootstrapped);
        localStorage.setItem(profileCacheKey(firebaseUser.uid), JSON.stringify(bootstrapped));
      } catch (error) {
        console.error('Error loading auth profile:', error);
        // Si Firestore falla por reglas/permisos, seguimos con perfil local para no bloquear roles.
        if (!isMounted) return;
        setProfile(fallbackProfile);
        localStorage.setItem(profileCacheKey(firebaseUser.uid), JSON.stringify(fallbackProfile));
      }
    };

    // Evita quedarse bloqueado en "Cargando sesion...".
    const safetyTimeout = setTimeout(() => {
      console.warn('Auth timeout: continuing without blocking UI');
      stopLoading();
    }, 2500);

    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        clearTimeout(safetyTimeout);
        if (!isMounted) return;

        setUser(firebaseUser);
        stopLoading(); // No esperar Firestore para renderizar.

        if (!firebaseUser) {
          setProfile(null);
          return;
        }

        loadProfile(firebaseUser);
      },
      (error) => {
        clearTimeout(safetyTimeout);
        console.error('onAuthStateChanged error:', error);
        if (!isMounted) return;
        setUser(null);
        setProfile(null);
        stopLoading();
      }
    );

    return () => {
      isMounted = false;
      clearTimeout(safetyTimeout);
      unsubscribe();
    };
  }, []);

  const login = useCallback((email, password) => signInWithEmailAndPassword(auth, email, password), []);

  const logout = useCallback(async () => {
    if (user?.uid) localStorage.removeItem(profileCacheKey(user.uid));
    return signOut(auth);
  }, [user?.uid]);

  const value = useMemo(
    () => ({
      user,
      profile,
      loading,
      login,
      logout,
      isAdmin: profile?.role === 'admin',
      isManager: profile?.role === 'manager'
    }),
    [user, profile, loading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
