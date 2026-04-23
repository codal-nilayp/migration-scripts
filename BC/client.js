import axios from "axios";
export default function createBCClient(storeHash, token){
    return axios.create({
      baseURL: `https://api.bigcommerce.com/stores/${storeHash}/v3`,
      headers: {
        "X-Auth-Token": token,
        Accept: "application/json",
        "Content-Type": "application/json"
      }
    });
};