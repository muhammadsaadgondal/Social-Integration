const express = require('express');
const dotenv = require('dotenv');
const https = require('https');
const fs = require('fs');
const session = require('express-session');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const cors = require('cors');
const FormData = require('form-data');
const cloudinary = require('cloudinary');




const app = express();
const port = 3000;
// Enable CORS for all routes
app.use(cors());
dotenv.config();


const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const FB_appId = process.env.FACEBOOK_APP_ID;
const FB_appSecret = process.env.FACEBOOK_APP_SECRET;
const FB_redirectUri = 'https://localhost:3000/auth/facebook/callback';
const scopes = 'email,public_profile,pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_engagement,pages_read_user_content,business_management,instagram_manage_insights';
// Middleware
app.use(express.json());
app.use(
  session({
    secret: 'your-secret-key',
    resave: false,
    saveUninitialized: true,
  })
);


app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Set up multer to store the uploaded file in a 'uploads' directory
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); // Path where files will be stored
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Renaming the file to avoid duplicates
  }
});

const upload = multer({ storage: storage });


// Facebook auth route
app.get('/facebook/auth', (req, res) => {
  const authUrl = `https://www.facebook.com/dialog/oauth?client_id=${FB_appId}&redirect_uri=${FB_redirectUri}&scope=${scopes}`;
  res.redirect(authUrl);
});

// Facebook callback route
app.get('/auth/facebook/callback', (req, res) => {
  if (req.query.error_reason) return res.send(req.query.error_reason);
  if (req.query.code) {
    const loginCode = req.query.code;

    const tokenUrl = `https://graph.facebook.com/v17.0/oauth/access_token?client_id=${FB_appId}&redirect_uri=${FB_redirectUri}&client_secret=${FB_appSecret}&code=${loginCode}`;

    https.get(tokenUrl, (response) => {
      let data = '';
      response.on('data', (chunk) => (data += chunk));
      response.on('end', () => {
        const tokenData = JSON.parse(data);
        if (tokenData.error) return res.send(tokenData.error.message);

        req.session.access_token = tokenData.access_token;
        res.redirect('https://localhost:3000');
        // res.json({
        //   message: 'Successfully authenticated with Facebook!',
        //   access_token: tokenData.access_token,
        // });
      });
    });
  }
});

// Get User Pages
app.get('/pages', async (req, res) => {
  const userAccessToken = req.session.access_token;
  if (!userAccessToken) return res.status(401).send('User is not logged in.');

  try {
    const response = await axios.get(
      'https://graph.facebook.com/v17.0/me/accounts',
      { params: { access_token: userAccessToken } }
    );

    const pages = response.data.data.map((page) => ({
      id: page.id,
      name: page.name,
    }));

    res.json(pages);
  } catch (error) {
    console.error('Error fetching pages:', error.response?.data || error.message);
    res.status(500).send('Error fetching pages.');
  }
});



app.get('/page-metadata/:pageId', async (req, res) => {
  const { pageId } = req.params;
  const userAccessToken = req.session.access_token;

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Fetch page metadata
    const response = await axios.get(`https://graph.facebook.com/v17.0/${pageId}`, {
      params: {
        access_token: userAccessToken,
        fields: 'id,name,about,fan_count,category,website,link,picture',
      },
    });

    // Return metadata
    res.json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('Error fetching page metadata:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch page metadata.' });
  }
});

app.get('/get-page-posts', async (req, res) => {
  const { pageId = process.env.Horizon_pageId, limit = 10 } = req.query; // Accept pageId and limit as query parameters
  const userAccessToken = req.session?.access_token;

  if (!pageId) {
    return res.status(400).json({ error: 'pageId is required' });
  }

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Get Page Access Token
    const pageResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts`,
      { params: { access_token: userAccessToken } }
    );

    const page = pageResponse.data.data.find((p) => p.id === pageId);
    if (!page) {
      return res.status(404).json({ error: 'Page not found.' });
    }

    const pageAccessToken = page.access_token;

    // Fetch Posts with Pagination
    let posts = [];
    let nextPage = `https://graph.facebook.com/v17.0/${pageId}/posts?fields=id,message,created_time,likes.summary(true),comments.summary(true),shares,attachments{media_type,media,url},full_picture&limit=${limit}&access_token=${pageAccessToken}`;

    while (nextPage) {
      const postsResponse = await axios.get(nextPage);
      posts = posts.concat(postsResponse.data.data);

      // Check if there is a next page
      nextPage = postsResponse.data.paging?.next || null;

      // Optional: Stop fetching after a certain number of posts
      if (posts.length >= limit) break;
    }

    res.json({
      success: true,
      data: posts.slice(0, limit), // Return only the required number of posts
    });
  } catch (error) {
    console.error('Error fetching posts:', error.response?.data || error.message);
    res.status(500).json({ error: 'Error fetching posts', details: error.message });
  }
});

/* POSTING */
// Post to Page
app.post('/fb-post-now', upload.single('image'), async (req, res) => {
  console.log('====================================');
  console.log("Idr a pohanch raha ha vro");
  console.log('====================================');

  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const { pageId, message } = req.body; // Access fields from req.body
  const imagePath = req.file.path; // Path to the uploaded image

  if (!pageId || !message || !imagePath) {
    return res.status(400).send('Missing required parameters');
  }

  const userAccessToken = req.session.access_token;

  if (!userAccessToken) {
    return res.status(401).send('User is not authenticated.');
  }

  try {
    // Get the Page Access Token
    const pagesResponse = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: userAccessToken }
    });

    const page = pagesResponse.data.data.find(p => p.id === pageId);

    if (!page) {
      return res.status(404).send('Page not found');
    }

    const pageAccessToken = page.access_token;

    // Upload the image to the page
    const imageUploadUrl = `https://graph.facebook.com/v17.0/${pageId}/photos`;
    const formData = new FormData();
    formData.append('file', fs.createReadStream(imagePath)); // Correct path for image
    formData.append('message', message);
    formData.append('access_token', pageAccessToken);

    // Post the image
    const postResponse = await axios.post(imageUploadUrl, formData, {
      headers: {
        ...formData.getHeaders() // Correctly getting headers from the form-data package
      }
    });

    res.json({
      success: true,
      postId: postResponse.data.id,
      imageUrl: postResponse.data.url
    });

  } catch (error) {
    console.error('Error posting to Page:', error.response?.data || error.message);
    res.status(500).send('Error posting to the Page');
  }
});


app.post('/fb-schedule-post', upload.single('image'), async (req, res) => {
  const { pageId, message, scheduleTime } = req.body;
  const image = req.file;
  const userAccessToken = req.session?.access_token;

  // Validation
  if (!pageId || (!message && !image)) {
    return res.status(400).json({ error: 'pageId and either message or image are required' });
  }

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Ensure the scheduled time is in the future
    const scheduledDate = new Date(scheduleTime);
    const now = new Date();
    if (scheduledDate <= now) {
      return res.status(400).json({ error: 'Scheduled time must be in the future.' });
    }

    // Get Page Access Token
    const pageResponse = await axios.get(
      `https://graph.facebook.com/v17.0/me/accounts`,
      { params: { access_token: userAccessToken } }
    );

    const page = pageResponse.data.data.find((p) => p.id === pageId);
    if (!page) {
      return res.status(404).json({ error: 'Page not found.' });
    }

    const pageAccessToken = page.access_token;
    const scheduledPublishTime = Math.floor(scheduledDate.getTime() / 1000);

    // Prepare post parameters
    const postParams = {
      message,
      published: false,
      scheduled_publish_time: scheduledPublishTime,
      access_token: pageAccessToken,
    };

    // If image is provided, handle image upload
    if (image) {
      try {
        const imageUploadUrl = `https://graph.facebook.com/v17.0/${pageId}/photos`;
        const formData = new FormData();
        formData.append('file', fs.createReadStream(image.path));
        formData.append('access_token', pageAccessToken);

        // Add a unique identifier to prevent duplicate detection
        formData.append('no_story', 'true');

        const imageUploadResponse = await axios.post(imageUploadUrl, formData, {
          headers: {
            ...formData.getHeaders()
          }
        });

        // Add the photo to the post
        postParams.attached_media = JSON.stringify([{
          media_fbid: imageUploadResponse.data.id
        }]);
      } catch (imageUploadError) {
        console.error('Image upload error:', imageUploadError.response?.data || imageUploadError.message);

        // If it's a duplicate error, you might want to handle it differently
        if (imageUploadError.response?.data?.error?.code === 100) {
          // Log the error but continue with scheduling
          console.log('Image may have been previously uploaded');
        } else {
          // For other image upload errors, you might want to stop the process
          return res.status(500).json({
            error: 'Error uploading image',
            details: imageUploadError.message
          });
        }
      }
    }

    // Schedule the post
    const postResponse = await axios.post(
      `https://graph.facebook.com/v17.0/${pageId}/feed`,
      postParams
    );

    res.json({
      success: true,
      postId: postResponse.data.id,
      message: 'Post successfully scheduled.',
    });

  } catch (error) {
    console.error('Error scheduling post:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Error scheduling post',
      details: error.response?.data?.error || error.message
    });
  }
});

/* INSTAGRAM */

app.get('/instagram/accounts', async (req, res) => {
  const userAccessToken = req.session.access_token;

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Step 1: Fetch user's pages
    const pagesResponse = await axios.get(
      'https://graph.facebook.com/v17.0/me/accounts',
      { params: { access_token: userAccessToken } }
    );

    const pages = pagesResponse.data.data;

    const instagramDetails = [];

    // Step 2: Fetch Instagram account details for each connected page
    for (const page of pages) {
      const igResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}`,
        {
          params: {
            fields: 'instagram_business_account',
            access_token: page.access_token,
          },
        }
      );

      const igAccountId = igResponse.data.instagram_business_account?.id;

      if (igAccountId) {
        // Step 3: Fetch Instagram account details using the IG account ID
        const igAccountDetailsResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${igAccountId}`,
          {
            params: {
              fields: 'username,followers_count,media_count,name,biography',
              access_token: page.access_token,
            },
          }
        );

        const accountDetails = igAccountDetailsResponse.data;

        instagramDetails.push({
          instagram_account_id: igAccountId,
          username: accountDetails.username,
          followers_count: accountDetails.followers_count,
          media_count: accountDetails.media_count,
          name: accountDetails.name,
          bio: accountDetails.biography,
        });
      }
    }

    res.json({ success: true, instagramDetails });
  } catch (error) {
    console.error('Error fetching Instagram account details:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch Instagram account details.' });
  }
});


app.get('/instagram/posts', async (req, res) => {
  const { igAccountId } = req.query;
  const userAccessToken = req.session.access_token;

  if (!userAccessToken || !igAccountId) {
    return res.status(400).json({ error: 'Missing access token or Instagram account ID.' });
  }

  try {
    // Fetch recent Instagram posts
    const response = await axios.get(
      `https://graph.facebook.com/v17.0/${igAccountId}/media`,
      {
        params: {
          access_token: userAccessToken,
          fields: 'id,caption,media_type,media_url,timestamp',
        },
      }
    );

    res.json({ success: true, posts: response.data.data });
  } catch (error) {
    console.error('Error fetching Instagram posts:', error.response?.data || error.message);
    res.status(500).json({ error: 'Failed to fetch Instagram posts.' });
  }
});



app.post('/insta-post-now', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    // Upload to Cloudinary 
    const uploadResponse = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'image',
    });
    const imgUrl = uploadResponse.secure_url;

    // Check if Instagram account ID exists
    const instagramAccountId = req.body.instagramAccountId;
    if (!instagramAccountId) {
      return res.status(400).json({ error: 'Instagram account ID is missing' });
    }

    // Validate access token
    if (!req.session.access_token) {
      return res.status(401).json({ error: 'No access token available' });
    }

    try {
      // Create media container
      const instagramResponse = await axios.post(
        `https://graph.facebook.com/v17.0/${instagramAccountId}/media`,
        {
          image_url: imgUrl,
          caption: req.body.caption || '',
          access_token: req.session.access_token
        }
      );

      if (!instagramResponse.data.id) {
        return res.status(400).json({ error: 'Failed to create media container' });
      }

      const mediaId = instagramResponse.data.id;

      // Publish the media
      const publishResponse = await axios.post(
        `https://graph.facebook.com/v17.0/${instagramAccountId}/media_publish`,
        {
          creation_id: mediaId,
          access_token: req.session.access_token
        }
      );

      res.json({
        success: true,
        postId: mediaId,
        publishResponse: publishResponse.data
      });

    } catch (err) {
      console.error('Instagram posting error:', err.response?.data || err.message);
      return res.status(500).json({
        error: 'Error posting to Instagram',
        details: err.response?.data || err.message
      });
    }
  } catch (error) {
    console.error('Cloudinary upload error:', error.message);
    res.status(500).json({
      error: 'Error uploading to Cloudinary',
      details: error.message
    });
  }
});


//**********************COMBINED****************************************** */

app.post('/post-combined', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const { instagramAccountId, facebookPageId, message, caption } = req.body;
  const imagePath = req.file.path;

  if (!instagramAccountId || !facebookPageId || !message || !imagePath) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  // Validate access token
  if (!req.session.access_token) {
    return res.status(401).json({ error: 'No access token available' });
  }

  const userAccessToken = req.session.access_token;

  try {
    // First, post to Instagram
    // Upload the image to Cloudinary
    const uploadResponse = await cloudinary.uploader.upload(req.file.path, {
      resource_type: 'image',
    });
    const imgUrl = uploadResponse.secure_url;

    // Create media container for Instagram
    const instagramResponse = await axios.post(
      `https://graph.facebook.com/v17.0/${instagramAccountId}/media`,
      {
        image_url: imgUrl,
        caption: caption || '',
        access_token: userAccessToken
      }
    );

    if (!instagramResponse.data.id) {
      return res.status(400).json({ error: 'Failed to create media container for Instagram' });
    }

    const mediaId = instagramResponse.data.id;

    // Publish the media on Instagram
    const publishResponse = await axios.post(
      `https://graph.facebook.com/v17.0/${instagramAccountId}/media_publish`,
      {
        creation_id: mediaId,
        access_token: userAccessToken
      }
    );

    // Instagram post successful, now proceed to post on Facebook
    // Get the Facebook Page Access Token
    const pagesResponse = await axios.get(`https://graph.facebook.com/v17.0/me/accounts`, {
      params: { access_token: userAccessToken }
    });

    const page = pagesResponse.data.data.find(p => p.id === facebookPageId);

    if (!page) {
      return res.status(404).json({ error: 'Page not found' });
    }

    const pageAccessToken = page.access_token;

    // Upload image to Facebook Page
    const imageUploadUrl = `https://graph.facebook.com/v17.0/${facebookPageId}/photos`;
    const formData = new FormData();
    formData.append('file', fs.createReadStream(imagePath)); // Path to the image
    formData.append('message', message);
    formData.append('access_token', pageAccessToken);

    // Post image to Facebook Page
    const postResponse = await axios.post(imageUploadUrl, formData, {
      headers: {
        ...formData.getHeaders() // Correctly getting headers from the form-data package
      }
    });

    // Respond with success and post details
    res.json({
      success: true,
      instagramPostId: mediaId,
      instagramPublishResponse: publishResponse.data,
      facebookPostId: postResponse.data.id,
      facebookImageUrl: postResponse.data.url
    });

  } catch (error) {
    console.error('Error posting to Instagram and Facebook:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Error posting to Instagram and Facebook',
      details: error.response?.data || error.message
    });
  }
});


//****************************************************************
// Total Followers Endpoint
app.get('/total-followers', async (req, res) => {
  const userAccessToken = req.session.access_token;

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Step 1: Fetch user's pages
    const pagesResponse = await axios.get(
      'https://graph.facebook.com/v17.0/me/accounts',
      { params: { access_token: userAccessToken } }
    );

    const pages = pagesResponse.data.data;

    let totalFacebookFollowers = 0;
    let totalInstagramFollowers = 0;

    // Step 2: Fetch Facebook page fan count and Instagram followers
    for (const page of pages) {
      // Facebook page fan count
      const pageResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}`,
        {
          params: {
            fields: 'fan_count',
            access_token: page.access_token,
          },
        }
      );

      totalFacebookFollowers += pageResponse.data.fan_count || 0;

      // Check for Instagram business account
      const igResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}`,
        {
          params: {
            fields: 'instagram_business_account',
            access_token: page.access_token,
          },
        }
      );

      const igAccountId = igResponse.data.instagram_business_account?.id;

      if (igAccountId) {
        // Fetch Instagram account followers
        const igAccountDetailsResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${igAccountId}`,
          {
            params: {
              fields: 'followers_count',
              access_token: page.access_token,
            },
          }
        );

        totalInstagramFollowers += igAccountDetailsResponse.data.followers_count || 0;
      }
    }

    res.json({
      success: true,
      totalFollowers: {
        facebook: totalFacebookFollowers,
        instagram: totalInstagramFollowers,
        combined: totalFacebookFollowers + totalInstagramFollowers
      }
    });

  } catch (error) {
    console.error('Error fetching total followers:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch total followers',
      details: error.response?.data || error.message
    });
  }
});

// Total Reactions Endpoint (for current month)
// app.get('/total-reactions', async (req, res) => {
//   const userAccessToken = req.session.access_token;

//   if (!userAccessToken) {
//     return res.status(401).json({ error: 'User is not authenticated.' });
//   }

//   try {
//     // Step 1: Fetch user's pages
//     const pagesResponse = await axios.get(
//       'https://graph.facebook.com/v17.0/me/accounts',
//       { params: { access_token: userAccessToken } }
//     );

//     const pages = pagesResponse.data.data;

//     let totalFacebookReactions = 0;
//     let totalInstagramReactions = 0;

//     // Current month start and end dates
//     const now = new Date();
//     const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
//     const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

//     // Step 2: Fetch reactions for each page
//     for (const page of pages) {
//       // Facebook page posts reactions
//       const postsResponse = await axios.get(
//         `https://graph.facebook.com/v17.0/${page.id}/posts`,
//         {
//           params: {
//             fields: 'likes.summary(true),comments.summary(true),shares,created_time',
//             access_token: page.access_token,
//             since: startOfMonth.toISOString(),
//             until: endOfMonth.toISOString()
//           },
//         }
//       );

//       // Sum Facebook reactions
//       postsResponse.data.data.forEach(post => {
//         totalFacebookReactions += 
//           (post.likes?.summary?.total_count || 0) + 
//           (post.comments?.summary?.total_count || 0) + 
//           (post.shares?.count || 0);
//       });

//       // Check for Instagram business account
//       const igResponse = await axios.get(
//         `https://graph.facebook.com/v17.0/${page.id}`,
//         {
//           params: {
//             fields: 'instagram_business_account',
//             access_token: page.access_token,
//           },
//         }
//       );

//       const igAccountId = igResponse.data.instagram_business_account?.id;

//       if (igAccountId) {
//         // Fetch Instagram media and their insights
//         const igMediaResponse = await axios.get(
//           `https://graph.facebook.com/v17.0/${igAccountId}/media`,
//           {
//             params: {
//               fields: 'id,timestamp',
//               access_token: page.access_token,
//               since: startOfMonth.toISOString(),
//               until: endOfMonth.toISOString()
//             },
//           }
//         );

//         // For each media, get insights
//         for (const media of igMediaResponse.data.data) {
//           try {
//             const insightsResponse = await axios.get(
//               `https://graph.facebook.com/v17.0/${media.id}/insights`,
//               {
//                 params: {
//                   metric: 'likes,comments',
//                   access_token: page.access_token
//                 },
//               }
//             );

//             // Sum Instagram reactions
//             insightsResponse.data.data.forEach(insight => {
//               totalInstagramReactions += insight.values[0].value;
//             });
//           } catch (insightError) {
//             console.warn(`Could not fetch insights for media ${media.id}:`, insightError.message);
//           }
//         }
//       }
//     }

//     res.json({
//       success: true,
//       totalReactions: {
//         facebook: totalFacebookReactions,
//         instagram: totalInstagramReactions,
//         combined: totalFacebookReactions + totalInstagramReactions
//       }
//     });

//   } catch (error) {
//     console.error('Error fetching total reactions:', error.response?.data || error.message);
//     res.status(500).json({ 
//       error: 'Failed to fetch total reactions',
//       details: error.response?.data || error.message 
//     });
//   }
// });


app.get('/total-reactions', async (req, res) => {
  const userAccessToken = req.session.access_token;

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Step 1: Fetch user's pages
    const pagesResponse = await axios.get(
      'https://graph.facebook.com/v17.0/me/accounts',
      { params: { access_token: userAccessToken } }
    );

    const pages = pagesResponse.data.data;

    let totalFacebookReactions = 0;
    let totalInstagramReactions = 0;

    // Step 2: Fetch reactions for each page
    for (const page of pages) {
      // Facebook page posts reactions
      let nextPageUrl = `https://graph.facebook.com/v17.0/${page.id}/posts`;
      let hasMorePosts = true;

      while (hasMorePosts) {
        const postsResponse = await axios.get(
          nextPageUrl,
          {
            params: {
              fields: 'likes.summary(true),comments.summary(true),shares,created_time',
              access_token: page.access_token,
              limit: 100 // Fetch 100 posts per request
            },
          }
        );

        // Sum Facebook reactions
        postsResponse.data.data.forEach(post => {
          totalFacebookReactions +=
            (post.likes?.summary?.total_count || 0) +
            (post.comments?.summary?.total_count || 0) +
            (post.shares?.count || 0);
        });

        // Check if there are more pages of posts
        nextPageUrl = postsResponse.data.paging?.next;
        hasMorePosts = !!nextPageUrl;
      }

      // Check for Instagram business account
      const igResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}`,
        {
          params: {
            fields: 'instagram_business_account',
            access_token: page.access_token,
          },
        }
      );

      const igAccountId = igResponse.data.instagram_business_account?.id;

      if (igAccountId) {
        // Fetch Instagram media
        let nextMediaUrl = `https://graph.facebook.com/v17.0/${igAccountId}/media`;
        let hasMoreMedia = true;

        while (hasMoreMedia) {
          const igMediaResponse = await axios.get(
            nextMediaUrl,
            {
              params: {
                fields: 'id,timestamp',
                access_token: page.access_token,
                limit: 100 // Fetch 100 media items per request
              },
            }
          );

          // For each media, get insights
          for (const media of igMediaResponse.data.data) {
            try {
              const insightsResponse = await axios.get(
                `https://graph.facebook.com/v17.0/${media.id}/insights`,
                {
                  params: {
                    metric: 'likes,comments',
                    access_token: page.access_token
                  },
                }
              );

              // Sum Instagram reactions
              insightsResponse.data.data.forEach(insight => {
                totalInstagramReactions += insight.values[0].value;
              });
            } catch (insightError) {
              console.warn(`Could not fetch insights for media ${media.id}:`, insightError.message);
            }
          }

          // Check if there are more pages of media
          nextMediaUrl = igMediaResponse.data.paging?.next;
          hasMoreMedia = !!nextMediaUrl;
        }
      }
    }

    res.json({
      success: true,
      totalReactions: {
        facebook: totalFacebookReactions,
        instagram: totalInstagramReactions,
        combined: totalFacebookReactions + totalInstagramReactions
      }
    });

  } catch (error) {
    console.error('Error fetching total reactions:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch total reactions',
      details: error.response?.data || error.message
    });
  }
});

// Helper function to get followers for a page
async function getPageFollowers(page) {
  let facebookFollowers = 0;
  let instagramFollowers = 0;

  // Fetch Facebook page fan count
  const pageResponse = await axios.get(
    `https://graph.facebook.com/v17.0/${page.id}`,
    {
      params: {
        fields: 'fan_count',
        access_token: page.access_token,
      },
    }
  );

  facebookFollowers = pageResponse.data.fan_count || 0;

  // Check for Instagram business account
  const igResponse = await axios.get(
    `https://graph.facebook.com/v17.0/${page.id}`,
    {
      params: {
        fields: 'instagram_business_account',
        access_token: page.access_token,
      },
    }
  );

  const igAccountId = igResponse.data.instagram_business_account?.id;

  if (igAccountId) {
    // Fetch Instagram account followers
    const igAccountDetailsResponse = await axios.get(
      `https://graph.facebook.com/v17.0/${igAccountId}`,
      {
        params: {
          fields: 'followers_count',
          access_token: page.access_token,
        },
      }
    );

    instagramFollowers = igAccountDetailsResponse.data.followers_count || 0;
  }

  return {
    facebookFollowers,
    instagramFollowers
  };
}

app.get('/average-engagement-rate', async (req, res) => {
  const userAccessToken = req.session.access_token;

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Step 1: Fetch user's pages
    const pagesResponse = await axios.get(
      'https://graph.facebook.com/v17.0/me/accounts',
      { params: { access_token: userAccessToken } }
    );

    const pages = pagesResponse.data.data;

    const engagementResults = [];

    // Current month start and end dates
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    // Step 2: Calculate engagement rate for each page
    for (const page of pages) {
      // Get followers for the page
      const { facebookFollowers, instagramFollowers } = await getPageFollowers(page);

      let pageEngagementData = {
        pageName: page.name,
        pageId: page.id,
        facebookFollowers,
        instagramFollowers,
        facebookAverageEngagementRate: null,
        instagramAverageEngagementRate: null,
        combinedAverageEngagementRate: null,
        facebookPosts: [],
        instagramPosts: []
      };

      // Fetch Facebook posts
      const postsResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}/posts`,
        {
          params: {
            fields: 'id,likes.summary(true),comments.summary(true),shares,created_time,message,full_picture',
            access_token: page.access_token,
            since: startOfMonth.toISOString(),
            until: endOfMonth.toISOString()
          },
        }
      );

      // Calculate Facebook engagement
      const facebookPosts = postsResponse.data.data.map(post => {
        const likes = post.likes?.summary?.total_count || 0;
        const comments = post.comments?.summary?.total_count || 0;

        // Use followers as a proxy for reach since we can't easily get post-specific reach
        const reach = facebookFollowers;

        const engagementRate = reach > 0
          ? (((likes + comments) / reach) * 100).toFixed(2)
          : 0;

        return {
          postId: post.id,
          message: post.message,
          likes,
          comments,
          reach,
          engagementRate: parseFloat(engagementRate)
        };
      });

      pageEngagementData.facebookPosts = facebookPosts;

      // Calculate average Facebook engagement rate
      const facebookEngagementRates = facebookPosts.map(post => post.engagementRate);
      pageEngagementData.facebookAverageEngagementRate =
        facebookEngagementRates.length > 0
          ? (facebookEngagementRates.reduce((a, b) => a + b, 0) / facebookEngagementRates.length).toFixed(2)
          : 0;

      // Check for Instagram business account
      const igResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}`,
        {
          params: {
            fields: 'instagram_business_account',
            access_token: page.access_token,
          },
        }
      );

      const igAccountId = igResponse.data.instagram_business_account?.id;

      if (igAccountId) {
        // Fetch Instagram media 
        const igMediaResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${igAccountId}/media`,
          {
            params: {
              fields: 'id,caption,timestamp,like_count,comments_count',
              access_token: page.access_token,
              since: startOfMonth.toISOString(),
              until: endOfMonth.toISOString()
            },
          }
        );

        // Calculate Instagram engagement
        const instagramPosts = igMediaResponse.data.data.map(media => {
          const likes = media.like_count || 0;
          const comments = media.comments_count || 0;

          // Use followers as a proxy for reach since we can't easily get post-specific reach
          const reach = instagramFollowers;

          const engagementRate = reach > 0
            ? (((likes + comments) / reach) * 100).toFixed(2)
            : 0;

          return {
            mediaId: media.id,
            caption: media.caption,
            likes,
            comments,
            reach,
            engagementRate: parseFloat(engagementRate)
          };
        });

        pageEngagementData.instagramPosts = instagramPosts;

        // Calculate average Instagram engagement rate
        const instagramEngagementRates = instagramPosts.map(post => post.engagementRate);
        pageEngagementData.instagramAverageEngagementRate =
          instagramEngagementRates.length > 0
            ? (instagramEngagementRates.reduce((a, b) => a + b, 0) / instagramEngagementRates.length).toFixed(2)
            : 0;
      }

      if (pageEngagementData.facebookPosts.length > 0 && pageEngagementData.instagramPosts.length > 0) {
        pageEngagementData.combinedAverageEngagementRate =
          ((Number(pageEngagementData.instagramAverageEngagementRate) +
            Number(pageEngagementData.facebookAverageEngagementRate)) / 2).toFixed(2);
      } else if (pageEngagementData.facebookPosts.length > 0) {
        pageEngagementData.combinedAverageEngagementRate =
          pageEngagementData.facebookAverageEngagementRate;
      } else if (pageEngagementData.instagramPosts.length > 0) {
        pageEngagementData.combinedAverageEngagementRate =
          pageEngagementData.instagramAverageEngagementRate;
      } else {
        pageEngagementData.combinedAverageEngagementRate = null;
      }

      engagementResults.push(pageEngagementData);
    }

    res.json({
      success: true,
      engagementData: engagementResults
    });

  } catch (error) {
    console.error('Error fetching engagement rates:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch engagement rates',
      details: error.response?.data || error.message
    });
  }
});

app.get('/comment-notifications', async (req, res) => {
  const userAccessToken = req.session.access_token;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Fetch user's pages
    const pagesResponse = await axios.get(
      'https://graph.facebook.com/v17.0/me/accounts',
      { params: { access_token: userAccessToken } }
    );

    const pages = pagesResponse.data.data;
    const commentNotifications = [];

    // Process each page
    for (const page of pages) {
      // Fetch Facebook page posts with comments
      let nextPageUrl = `https://graph.facebook.com/v17.0/${page.id}/posts`;
      let hasMorePosts = true;

      while (hasMorePosts) {
        const postsResponse = await axios.get(
          nextPageUrl,
          {
            params: {
              fields: 'id,message,created_time,comments{id,message,created_time,from}',
              access_token: page.access_token,
              since: oneWeekAgo,
              limit: 100
            },
          }
        );

        // Process comments for each post
        postsResponse.data.data.forEach(post => {
          if (post.comments && post.comments.data) {
            post.comments.data.forEach(comment => {
              commentNotifications.push({
                platform: 'facebook',
                postId: post.id,
                postMessage: post.message || 'No post message',
                commentId: comment.id,
                commentMessage: comment.message,
                commentedBy: {
                  id: comment.from?.id,
                  name: comment.from?.name
                },
                createdTime: comment.created_time
              });
            });
          }
        });

        // Check for more posts
        nextPageUrl = postsResponse.data.paging?.next;
        hasMorePosts = !!nextPageUrl;
      }

      // Check for Instagram business account
      let igAccountId;
      try {
        const igResponse = await axios.get(
          `https://graph.facebook.com/v17.0/${page.id}`,
          {
            params: {
              fields: 'instagram_business_account',
              access_token: page.access_token,
            },
          }
        );

        igAccountId = igResponse.data.instagram_business_account?.id;
      } catch (igError) {
        console.warn(`Could not fetch Instagram business account for page ${page.id}:`, igError.message);
        continue; // Skip to next page if no Instagram account
      }

      if (igAccountId) {
        // Fetch Instagram media with comments
        let nextMediaUrl = `https://graph.facebook.com/v17.0/${igAccountId}/media`;
        let hasMoreMedia = true;

        while (hasMoreMedia) {
          try {
            const igMediaResponse = await axios.get(
              nextMediaUrl,
              {
                params: {
                  fields: 'id,caption,comments{id,text,timestamp,from}',
                  access_token: page.access_token,
                  limit: 100
                },
              }
            );

            console.log('Instagram Media Response:', JSON.stringify(igMediaResponse.data, null, 2));

            // Process comments for each media item
            igMediaResponse.data.data.forEach(media => {
              if (media.comments && media.comments.data) {
                media.comments.data.forEach(comment => {
                  commentNotifications.push({
                    platform: 'instagram',
                    mediaId: media.id,
                    mediaCaption: media.caption || 'No caption',
                    commentId: comment.id,
                    commentMessage: comment.text,
                    commentedBy: {
                      id: comment.from?.id,
                      username: comment.from?.username
                    },
                    createdTime: comment.timestamp
                  });
                });
              }
            });

            // Check for more media
            nextMediaUrl = igMediaResponse.data.paging?.next;
            hasMoreMedia = !!nextMediaUrl;

          } catch (mediaError) {
            console.error('Error fetching Instagram media:', {
              message: mediaError.message,
              response: mediaError.response?.data
            });
            break;
          }
        }
      }
    }

    // Sort notifications by creation time (most recent first)
    const sortedCommentNotifications = commentNotifications.sort((a, b) => 
      new Date(b.createdTime) - new Date(a.createdTime)
    );

    res.json({
      success: true,
      totalComments: sortedCommentNotifications.length,
      comments: sortedCommentNotifications
    });

  } catch (error) {
    console.error('Error fetching comment notifications:', {
      message: error.message,
      response: error.response?.data
    });
    res.status(500).json({
      error: 'Failed to fetch comment notifications',
      details: error.message
    });
  }
});

app.get('/top-performing-posts', async (req, res) => {
  const userAccessToken = req.session.access_token;
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  if (!userAccessToken) {
    return res.status(401).json({ error: 'User is not authenticated.' });
  }

  try {
    // Fetch user's pages
    const pagesResponse = await axios.get(
      'https://graph.facebook.com/v17.0/me/accounts',
      { params: { access_token: userAccessToken } }
    );

    const pages = pagesResponse.data.data;
    const topPerformingPosts = [];

    // Process each page
    for (const page of pages) {
      // Fetch Facebook page posts with detailed metrics
      let nextPageUrl = `https://graph.facebook.com/v17.0/${page.id}/posts`;
      let hasMorePosts = true;

      while (hasMorePosts) {
        const postsResponse = await axios.get(
          nextPageUrl,
          {
            params: {
              fields: 'id,message,full_picture,created_time,likes.summary(true),comments.summary(true),shares',
              access_token: page.access_token,
              since: oneWeekAgo,
              limit: 100
            },
          }
        );

        // Process and calculate engagement for each post
        postsResponse.data.data.forEach(post => {
          const likesCount = post.likes?.summary?.total_count || 0;
          const commentsCount = post.comments?.summary?.total_count || 0;
          const sharesCount = post.shares?.count || 0;
          
          // Calculate total engagement
          const totalEngagement = likesCount + commentsCount + sharesCount;

          topPerformingPosts.push({
            platform: 'facebook',
            pageId: page.id,
            pageName: page.name,
            postId: post.id,
            message: post.message || 'No message',
            imageUrl: post.full_picture || null,
            createdTime: post.created_time,
            engagement: {
              likes: likesCount,
              comments: commentsCount,
              shares: sharesCount,
              total: totalEngagement
            }
          });
        });

        // Check for more posts
        nextPageUrl = postsResponse.data.paging?.next;
        hasMorePosts = !!nextPageUrl;
      }

      // Check for Instagram business account
      const igResponse = await axios.get(
        `https://graph.facebook.com/v17.0/${page.id}`,
        {
          params: {
            fields: 'instagram_business_account',
            access_token: page.access_token,
          },
        }
      );

      const igAccountId = igResponse.data.instagram_business_account?.id;

      if (igAccountId) {
        // Fetch Instagram media with insights
        let nextMediaUrl = `https://graph.facebook.com/v17.0/${igAccountId}/media`;
        let hasMoreMedia = true;

        while (hasMoreMedia) {
          const igMediaResponse = await axios.get(
            nextMediaUrl,
            {
              params: {
                fields: 'id,caption,media_type,media_url,timestamp,comments_count',
                access_token: page.access_token,
                limit: 100
              },
            }
          );

          // Process each media item and fetch its insights
          for (const media of igMediaResponse.data.data) {
            try {
              const insightsResponse = await axios.get(
                `https://graph.facebook.com/v17.0/${media.id}/insights`,
                {
                  params: {
                    metric: 'likes,comments,impressions',
                    access_token: page.access_token
                  },
                }
              );

              // Extract metrics
              const metricsMap = {};
              insightsResponse.data.data.forEach(metric => {
                metricsMap[metric.name] = metric.values[0].value;
              });

              const likesCount = metricsMap['likes'] || 0;
              const commentsCount = metricsMap['comments'] || 0;
              const impressionsCount = metricsMap['impressions'] || 0;

              topPerformingPosts.push({
                platform: 'instagram',
                pageId: igAccountId,
                postId: media.id,
                message: media.caption || 'No caption',
                imageUrl: media.media_url,
                mediaType: media.media_type,
                createdTime: media.timestamp,
                engagement: {
                  likes: likesCount,
                  comments: commentsCount,
                  impressions: impressionsCount,
                  total: likesCount + commentsCount + impressionsCount
                }
              });
            } catch (insightError) {
              console.warn(`Could not fetch insights for media ${media.id}:`, insightError.message);
            }
          }

          // Check for more media
          nextMediaUrl = igMediaResponse.data.paging?.next;
          hasMoreMedia = !!nextMediaUrl;
        }
      }
    }

    // Sort posts by total engagement (descending)
    const sortedPosts = topPerformingPosts
      .sort((a, b) => b.engagement.total - a.engagement.total)
      // Limit to top 10 performing posts
      .slice(0, 10);

    res.json({
      success: true,
      totalPosts: sortedPosts.length,
      topPosts: sortedPosts
    });

  } catch (error) {
    console.error('Error fetching top performing posts:', error.response?.data || error.message);
    res.status(500).json({
      error: 'Failed to fetch top performing posts',
      details: error.response?.data || error.message
    });
  }
});

/* SERVER CONFIGURATIONS */

// HTTPS Server
const sslOptions = {
  key: fs.readFileSync('./localhost-key.pem'),
  cert: fs.readFileSync('./localhost.pem'),
};

https.createServer(sslOptions, app).listen(port, () => {
  console.log(`HTTPS Server listening on https://localhost:${port}`);
});
