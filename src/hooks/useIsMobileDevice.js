import { useEffect, useState } from 'react';

const MOBILE_DEVICE_REGEX = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

const detectMobileDevice = () => {
  if (typeof window === 'undefined') return false;

  const userAgent = window.navigator.userAgent || '';
  const hasMobileUserAgent = MOBILE_DEVICE_REGEX.test(userAgent);
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const narrowViewport = window.innerWidth <= 900;

  return hasMobileUserAgent || (coarsePointer && narrowViewport);
};

function useIsMobileDevice() {
  const [isMobileDevice, setIsMobileDevice] = useState(detectMobileDevice);

  useEffect(() => {
    const updateDeviceType = () => setIsMobileDevice(detectMobileDevice());

    updateDeviceType();
    window.addEventListener('resize', updateDeviceType);
    window.addEventListener('orientationchange', updateDeviceType);

    return () => {
      window.removeEventListener('resize', updateDeviceType);
      window.removeEventListener('orientationchange', updateDeviceType);
    };
  }, []);

  return isMobileDevice;
}

export default useIsMobileDevice;
