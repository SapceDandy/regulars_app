import { vercelHandler } from '../apps/web/vercel.js';
export const config = {api: {bodyParser: false}};
export default vercelHandler();
