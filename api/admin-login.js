import { route, checkAdminPassword, ApiError } from '../lib/http.js';

export default route(['POST'], async ({ body }) => {
  if (!checkAdminPassword(body.password)) throw new ApiError(401, 'Incorrect password.');
  return {};
});
