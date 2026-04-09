import { useCallback, useEffect, useState } from 'react';

const DEFAULT_MATCHERS = ['netum', 'scanner', 'barcode', 'hid'];

const normalizeName = (value) => String(value || '').trim().toLowerCase();

const matchesScannerName = (device, preferredMatchers) => {
  const productName = normalizeName(device?.productName);
  if (!productName) return false;
  return preferredMatchers.some((matcher) => productName.includes(matcher));
};

function useScannerHidStatus(preferredMatchers = DEFAULT_MATCHERS) {
  const [hidSupported, setHidSupported] = useState(false);
  const [scannerDetected, setScannerDetected] = useState(false);
  const [deviceName, setDeviceName] = useState('');

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.hid?.getDevices) {
      setHidSupported(false);
      setScannerDetected(false);
      setDeviceName('');
      return;
    }

    setHidSupported(true);

    try {
      const devices = await navigator.hid.getDevices();
      const matchedDevice = devices.find((device) => matchesScannerName(device, preferredMatchers));
      setScannerDetected(Boolean(matchedDevice));
      setDeviceName(matchedDevice?.productName || '');
    } catch (error) {
      console.error('Error checking HID devices:', error);
      setScannerDetected(false);
      setDeviceName('');
    }
  }, [preferredMatchers]);

  const requestScannerAccess = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.hid?.requestDevice) {
      return false;
    }

    try {
      const devices = await navigator.hid.requestDevice({ filters: [] });
      const matchedDevice = devices.find((device) => matchesScannerName(device, preferredMatchers)) || devices[0];
      setScannerDetected(Boolean(matchedDevice));
      setDeviceName(matchedDevice?.productName || '');
      return Boolean(matchedDevice);
    } catch (error) {
      if (error?.name !== 'NotAllowedError') {
        console.error('Error requesting HID device:', error);
      }
      return false;
    }
  }, [preferredMatchers]);

  useEffect(() => {
    refreshDevices();
  }, [refreshDevices]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.hid) return undefined;

    const handleChange = () => {
      refreshDevices();
    };

    navigator.hid.addEventListener('connect', handleChange);
    navigator.hid.addEventListener('disconnect', handleChange);

    return () => {
      navigator.hid.removeEventListener('connect', handleChange);
      navigator.hid.removeEventListener('disconnect', handleChange);
    };
  }, [refreshDevices]);

  return {
    hidSupported,
    scannerDetected,
    deviceName,
    refreshDevices,
    requestScannerAccess
  };
}

export default useScannerHidStatus;
