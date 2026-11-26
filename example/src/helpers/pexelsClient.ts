import { createClient } from 'pexels';

// A free key from https://www.pexels.com/api/ for the examples that stream
// Pexels videos (the video player and the composition).
const API_KEY = 'your-api-key';

export const hasPexelsApiKey = API_KEY !== 'your-api-key';

const pexelsClient = createClient(API_KEY);

export default pexelsClient;
