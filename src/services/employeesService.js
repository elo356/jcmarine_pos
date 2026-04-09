import { createUserWithEmailAndPassword, getAuth, signOut as firebaseSignOut } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from 'firebase/firestore';
import { createSecondaryApp, db, disposeSecondaryApp } from '../firebase/config';

const employeesCollection = collection(db, 'employees');
const orderedEmployeesQuery = query(employeesCollection, orderBy('createdAt', 'desc'));

const mapDoc = (snapshot) => ({
  id: snapshot.id,
  ...snapshot.data()
});

const getTimestampValue = (value) => {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (typeof value.seconds === 'number') return (value.seconds * 1000) + Math.floor((value.nanoseconds || 0) / 1000000);

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortEmployees = (rows) => (
  [...rows].sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt))
);

export const listEmployees = async () => {
  try {
    const snapshot = await getDocs(orderedEmployeesQuery);
    return sortEmployees(snapshot.docs.map(mapDoc));
  } catch (error) {
    console.warn('Ordered employees query failed, retrying without orderBy.', error);
    const fallbackSnapshot = await getDocs(employeesCollection);
    return sortEmployees(fallbackSnapshot.docs.map(mapDoc));
  }
};

export const subscribeEmployees = (onData, onError) => {
  let activeUnsubscribe = () => {};
  let fallbackStarted = false;

  const startFallbackSubscription = () => {
    if (fallbackStarted) return;
    fallbackStarted = true;

    activeUnsubscribe = onSnapshot(
      employeesCollection,
      (snapshot) => {
        onData(sortEmployees(snapshot.docs.map(mapDoc)));
      },
      onError
    );
  };

  activeUnsubscribe = onSnapshot(
    orderedEmployeesQuery,
    (snapshot) => {
      onData(sortEmployees(snapshot.docs.map(mapDoc)));
    },
    (error) => {
      console.warn('Ordered employees subscription failed, retrying without orderBy.', error);
      startFallbackSubscription();
    }
  );

  return () => {
    activeUnsubscribe();
  };
};

export const createEmployeeWithAccount = async ({
  name,
  email,
  password,
  phone,
  role,
  hourlyRate,
  startDate,
  status,
  address,
  createdBy
}) => {
  const secondaryApp = createSecondaryApp();
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const credential = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = credential.user.uid;

    const employeePayload = {
      uid,
      name,
      email,
      phone: phone || '',
      role,
      hourlyRate: Number(hourlyRate) || 0,
      startDate,
      status,
      address: address || '',
      createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const userPayload = {
      uid,
      name,
      email,
      role,
      status,
      phone: phone || '',
      employeeRef: uid,
      createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    await setDoc(doc(db, 'employees', uid), employeePayload);
    await setDoc(doc(db, 'users', uid), userPayload, { merge: true });

    return uid;
  } finally {
    await firebaseSignOut(secondaryAuth);
    await disposeSecondaryApp(secondaryApp);
  }
};

export const updateEmployee = async (employeeId, payload) => {
  const employeeRef = doc(db, 'employees', employeeId);
  const userRef = doc(db, 'users', employeeId);

  const sharedPayload = {
    name: payload.name,
    email: payload.email,
    phone: payload.phone || '',
    role: payload.role,
    status: payload.status,
    updatedAt: serverTimestamp()
  };

  await updateDoc(employeeRef, {
    ...sharedPayload,
    hourlyRate: Number(payload.hourlyRate) || 0,
    startDate: payload.startDate,
    address: payload.address || ''
  });

  await setDoc(userRef, sharedPayload, { merge: true });
};

export const deleteEmployee = async (employeeId) => {
  await deleteDoc(doc(db, 'employees', employeeId));
  await deleteDoc(doc(db, 'users', employeeId));
};

export const toggleEmployeeStatus = async (employee) => {
  const nextStatus = employee.status === 'active' ? 'inactive' : 'active';

  await updateDoc(doc(db, 'employees', employee.id), {
    status: nextStatus,
    updatedAt: serverTimestamp()
  });

  await setDoc(doc(db, 'users', employee.id), {
    status: nextStatus,
    updatedAt: serverTimestamp()
  }, { merge: true });
};
