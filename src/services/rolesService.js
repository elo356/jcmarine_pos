import { collection, doc, onSnapshot, serverTimestamp, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../firebase/config';
import { DEFAULT_ROLE_DEFINITIONS } from '../config/rolePermissions';

const ROLES_COLLECTION = 'roles';
const ROLE_CACHE_KEY = 'pos:role-definitions';

const normalizePermissions = (permissions = []) => (
  [...new Set((Array.isArray(permissions) ? permissions : []).map((value) => String(value || '').trim()).filter(Boolean))]
);

export const normalizeRoleDefinition = (role = {}) => ({
  id: String(role.id || '').trim().toLowerCase(),
  name: String(role.name || role.id || '').trim(),
  description: String(role.description || '').trim(),
  permissions: normalizePermissions(role.permissions),
  system: role.system === true
});

export const getDefaultRoleDefinitions = () => DEFAULT_ROLE_DEFINITIONS.map(normalizeRoleDefinition);

export const loadCachedRoleDefinitions = () => {
  if (typeof window === 'undefined') return getDefaultRoleDefinitions();

  const cached = localStorage.getItem(ROLE_CACHE_KEY);
  if (!cached) return getDefaultRoleDefinitions();

  try {
    const parsed = JSON.parse(cached);
    const normalized = (Array.isArray(parsed) ? parsed : []).map(normalizeRoleDefinition).filter((role) => role.id);
    return normalized.length > 0 ? normalized : getDefaultRoleDefinitions();
  } catch (error) {
    console.error('Error parsing cached role definitions:', error);
    return getDefaultRoleDefinitions();
  }
};

const cacheRoleDefinitions = (roles) => {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ROLE_CACHE_KEY, JSON.stringify(roles.map(normalizeRoleDefinition)));
};

const mergeWithDefaults = (remoteRoles = []) => {
  const merged = new Map(getDefaultRoleDefinitions().map((role) => [role.id, role]));
  remoteRoles.forEach((role) => {
    const normalized = normalizeRoleDefinition(role);
    if (!normalized.id) return;
    const fallback = merged.get(normalized.id);
    merged.set(normalized.id, {
      ...fallback,
      ...normalized,
      permissions: fallback?.system
        ? normalizePermissions([...(fallback.permissions || []), ...(normalized.permissions || [])])
        : normalized.permissions
    });
  });

  return [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
};

export const subscribeRoleDefinitions = (onData, onError) => {
  onData(loadCachedRoleDefinitions(), { fromCache: true });

  return onSnapshot(
    collection(db, ROLES_COLLECTION),
    (snapshot) => {
      const roles = mergeWithDefaults(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
      cacheRoleDefinitions(roles);
      onData(roles, { fromCache: false });
    },
    (error) => {
      console.error('Error subscribing role definitions:', error);
      onData(loadCachedRoleDefinitions(), { fromCache: true, failed: true });
      if (onError) onError(error);
    }
  );
};

export const saveRoleDefinition = async (role) => {
  const normalized = normalizeRoleDefinition(role);
  if (!normalized.id) {
    throw new Error('El identificador del rol es requerido.');
  }

  await setDoc(
    doc(db, ROLES_COLLECTION, normalized.id),
    {
      name: normalized.name,
      description: normalized.description,
      permissions: normalized.permissions,
      system: normalized.system === true,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
};

export const deleteRoleDefinition = async (roleId) => {
  await deleteDoc(doc(db, ROLES_COLLECTION, roleId));
};
