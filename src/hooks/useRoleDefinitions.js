import { useEffect, useMemo, useState } from 'react';
import { getDefaultRoleDefinitions, subscribeRoleDefinitions } from '../services/rolesService';

export const useRoleDefinitions = () => {
  const [roles, setRoles] = useState(getDefaultRoleDefinitions());

  useEffect(() => {
    const unsubscribe = subscribeRoleDefinitions(
      (nextRoles) => setRoles(nextRoles),
      () => {}
    );

    return () => unsubscribe();
  }, []);

  const roleMap = useMemo(
    () => new Map(roles.map((role) => [role.id, role])),
    [roles]
  );

  const resolveRoleDefinition = (roleId) => roleMap.get(roleId) || roleMap.get('cashier') || roles[0] || null;
  const hasPermission = (roleId, permissionId) => Boolean(resolveRoleDefinition(roleId)?.permissions?.includes(permissionId));

  return {
    roles,
    roleMap,
    resolveRoleDefinition,
    hasPermission
  };
};
