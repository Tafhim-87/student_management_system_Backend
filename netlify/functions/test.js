exports.handler = async function(event, context) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: "Test function is working!",
      timestamp: new Date().toISOString(),
      path: event.path
    })
  };
};