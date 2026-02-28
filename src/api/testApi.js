import axios from "axios";

export const testBackend = async () => {
  try {
    const res = await axios.get("http://localhost:5000/api/test");
    console.log(res.data);
  } catch (err) {
    console.error("Backend connection failed", err);
  }
};