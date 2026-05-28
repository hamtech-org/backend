import { logger } from './logger.js';

/**
 * Thông tin vị trí từ IP address
 */
export interface ILocationInfo {
  city: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  timezone: string;
  isp: string;
}

/**
 * Kiểm tra IP có phải private/local không
 */
const isPrivateIp = (ip: string): boolean => {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost' || ip === 'unknown') {
    return true;
  }

  // Handle IPv6-mapped IPv4: ::ffff:192.168.1.1
  let cleanIp = ip;
  if (cleanIp.startsWith('::ffff:')) {
    cleanIp = cleanIp.slice(7);
  }

  const parts = cleanIp.split('.').map(Number);
  if (parts.length !== 4) return true; // Not IPv4

  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 169.254.0.0/16 (link-local)
  if (parts[0] === 169 && parts[1] === 254) return true;

  return false;
};

/**
 * Fetch với timeout
 */
const fetchWithTimeout = async (url: string, timeoutMs: number = 3000): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Lấy thông tin vị trí từ IP address
 * Sử dụng API: https://freeipapi.com
 *
 * @returns ILocationInfo hoặc null nếu không thể xác định
 */
export const getLocationFromIp = async (ip: string): Promise<ILocationInfo | null> => {
  try {
    if (isPrivateIp(ip)) {
      logger.debug(`Geolocation: IP "${ip}" là private/local — bỏ qua`);
      return null;
    }

    const response = await fetchWithTimeout(`https://freeipapi.com/api/json/${ip}`, 3000);

    if (!response.ok) {
      logger.warn(`Geolocation: API trả về status ${response.status} cho IP "${ip}"`);
      return null;
    }

    const data = (await response.json()) as {
      cityName?: string;
      regionName?: string;
      countryName?: string;
      countryCode?: string;
      latitude?: number;
      longitude?: number;
      timeZones?: string[];
      asnOrganization?: string;
    };

    return {
      city: data.cityName || '',
      region: data.regionName || '',
      country: data.countryName || '',
      countryCode: data.countryCode || '',
      latitude: data.latitude || 0,
      longitude: data.longitude || 0,
      timezone: data.timeZones?.[0] || '',
      isp: data.asnOrganization || '',
    };
  } catch (error) {
    logger.warn('Geolocation: Không thể lấy location từ IP', { ip, error });
    return null;
  }
};
