const { app } = require('@azure/functions');

app.http('healthCheck', {
    methods: ['GET', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'health-check',
    handler: async (request, context) => {
        context.log('Health check function triggered');
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
                    'Access-Control-Allow-Methods': 'GET, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Access-Control-Max-Age': '86400'
                }
            };
        }

        try {
            return {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    status: 'healthy',
                    timestamp: new Date().toISOString(),
                    azureStorage: 'not_tested',
                    kitApi: 'not_tested',
                    environment: process.env.NODE_ENV || 'development'
                })
            };
        } catch (error) {
            context.log.error('Error:', error);
            return {
                status: 500,
                headers: {
                    'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    status: 'unhealthy',
                    error: 'Health check failed',
                    timestamp: new Date().toISOString()
                })
            };
        }
    }
});
