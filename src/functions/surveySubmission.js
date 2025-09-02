const { app } = require('@azure/functions');

app.http('surveySubmission', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'survey-submission',
    handler: async (request, context) => {
        context.log('Survey submission function triggered');
        
        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
                    'Access-Control-Allow-Methods': 'POST, OPTIONS',
                    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                    'Access-Control-Max-Age': '86400'
                }
            };
        }

        try {
            // Basic response for now
            return {
                status: 200,
                headers: {
                    'Access-Control-Allow-Origin': process.env.FRONTEND_DOMAIN || '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    success: true,
                    message: 'Survey endpoint is working!',
                    timestamp: new Date().toISOString()
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
                    success: false,
                    error: 'Internal server error'
                })
            };
        }
    }
});
