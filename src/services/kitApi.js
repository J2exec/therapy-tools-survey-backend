const fetch = require('node-fetch');

/**
 * Sync tags to Kit.com for a user
 */
async function syncTagsToKit(data) {
  const { email, tags } = data;
  
  if (!process.env.KIT_API_KEY) {
    throw new Error('KIT_API_KEY environment variable is not set');
  }
  
  // Prepare Kit.com payload
  const kitPayload = {
    email: email,
    tags: tags.map(tag => ({ name: tag }))
  };
  
  try {
    const response = await fetch('https://api.kit.com/v3/subscribers', {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${process.env.KIT_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(kitPayload),
      timeout: 30000 // 30 second timeout
    });
    
    const responseData = await response.text();
    
    if (response.ok) {
      console.log(`Successfully synced ${tags.length} tags to Kit.com for ${email}`);
      return {
        success: true,
        status: response.status,
        data: responseData
      };
    } else {
      console.error(`Kit.com API error for ${email}:`, response.status, responseData);
      return {
        success: false,
        status: response.status,
        error: responseData
      };
    }
  } catch (error) {
    console.error(`Kit.com API request failed for ${email}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Get subscriber information from Kit.com
 */
async function getKitSubscriber(email) {
  if (!process.env.KIT_API_KEY) {
    throw new Error('KIT_API_KEY environment variable is not set');
  }
  
  try {
    const response = await fetch(`https://api.kit.com/v3/subscribers/${encodeURIComponent(email)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KIT_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: 30000
    });
    
    const responseData = await response.json();
    
    if (response.ok) {
      return {
        success: true,
        data: responseData
      };
    } else {
      return {
        success: false,
        status: response.status,
        error: responseData
      };
    }
  } catch (error) {
    console.error(`Failed to get Kit.com subscriber ${email}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Remove tags from a Kit.com subscriber
 */
async function removeKitTags(email, tags) {
  if (!process.env.KIT_API_KEY) {
    throw new Error('KIT_API_KEY environment variable is not set');
  }
  
  const kitPayload = {
    email: email,
    tags: tags.map(tag => ({ name: tag }))
  };
  
  try {
    const response = await fetch('https://api.kit.com/v3/subscribers/tags', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${process.env.KIT_API_KEY}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(kitPayload),
      timeout: 30000
    });
    
    const responseData = await response.text();
    
    if (response.ok) {
      console.log(`Successfully removed ${tags.length} tags from Kit.com for ${email}`);
      return {
        success: true,
        status: response.status,
        data: responseData
      };
    } else {
      console.error(`Kit.com tag removal error for ${email}:`, response.status, responseData);
      return {
        success: false,
        status: response.status,
        error: responseData
      };
    }
  } catch (error) {
    console.error(`Kit.com tag removal failed for ${email}:`, error);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Test Kit.com API connectivity
 */
async function testKitConnection() {
  if (!process.env.KIT_API_KEY) {
    return {
      success: false,
      error: 'KIT_API_KEY environment variable is not set'
    };
  }
  
  try {
    const response = await fetch('https://api.kit.com/v3/account', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.KIT_API_KEY}`,
        'Accept': 'application/json'
      },
      timeout: 15000
    });
    
    if (response.ok) {
      return {
        success: true,
        status: 'Kit.com API is accessible'
      };
    } else {
      return {
        success: false,
        status: response.status,
        error: 'Kit.com API returned an error'
      };
    }
  } catch (error) {
    return {
      success: false,
      error: `Kit.com API connection failed: ${error.message}`
    };
  }
}

module.exports = {
  syncTagsToKit,
  getKitSubscriber,
  removeKitTags,
  testKitConnection
};
