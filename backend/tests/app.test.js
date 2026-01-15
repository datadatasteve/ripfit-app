const request = require('supertest');
const app = require('../src/app');

describe('RipFit API', () => {
  describe('Health Check', () => {
    it('should return 200 and health status', async () => {
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'ok');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('API Root', () => {
    it('should return API information', async () => {
      const response = await request(app).get('/api/v1');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('message', 'RipFit API');
      expect(response.body).toHaveProperty('version', 'v1');
      expect(response.body).toHaveProperty('endpoints');
    });
  });

  describe('404 Handling', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(app).get('/api/v1/unknown-route');
      
      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Not Found');
    });
  });
});
