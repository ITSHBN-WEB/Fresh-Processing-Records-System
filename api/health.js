import { q } from '../lib/db.js';
import { route } from '../lib/http.js';

export default route(['GET'], async () => {
  await q('select 1');
  return { message: 'FPRS API is live.' };
});
