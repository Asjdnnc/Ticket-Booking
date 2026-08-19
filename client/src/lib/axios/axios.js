import axios from "axios";
import { SLICE_NAMES } from "../../constants/enums";
import { errorToast } from "../toast";

const getBaseUrl = () => {
  const envUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_DEPLOYED_BACKEND_HOSTNAME;
  
  if (!envUrl || envUrl === "undefined") {
    return "http://localhost:3001";
  }

  // Strip trailing /api or trailing slash so relative endpoints like "/api/seats" format cleanly
  const cleaned = envUrl.replace(/\/api\/?$/, "").replace(/\/$/, "");
  return cleaned;
};

export const axios_instance = axios.create({
  baseURL: getBaseUrl(),
  headers: {
    "Content-Type": "application/json",
  },
});

axios_instance.interceptors.request.use(
  (config) => {
    const token =
      localStorage.getItem("ticket_token") ||
      JSON.parse(localStorage.getItem(SLICE_NAMES.USER) || "{}")?.accessToken ||
      null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    console.log(error);
    return Promise.reject(error);
  },
);

axios_instance.interceptors.response.use(
  (response) => {
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      errorToast("Login expired. Please login again.");
      return Promise.reject(error);
    }
    return Promise.reject(error);
  },
);
