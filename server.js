import { createClient } from '@supabase/supabase-js'
import express from 'express'
import dotenv from 'dotenv'
import cors from 'cors'

// Load environment variables
dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseAdminKey = process.env.SUPABASE_SERVICE_KEY
const supabaseClientKey = process.env.SUPABASE_ANON_KEY
const FRONTEND_URL = process.env.FRONTEND_URL

if (!supabaseUrl || !supabaseAdminKey) {
  console.error('Missing required environment variables! Supabase URL or Service Key')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAdminKey)

const app = express()

// Middleware CORS
app.use(cors({
  origin: [
    'https://gobuy-frontend.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Requested-With',
    'Accept',
    'Origin'
  ]
}))

app.options('*', cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// API CALLS TO SUPABASE
// Get all products
app.get('/api/posts', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })
  
    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch products', 
        details: error.message 
      })
    }
    
    res.json(data)
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal error',
      details: err.message
    })
  }
})

// Add new product
app.post('/api/posts', async(req, res) => {
  const authHeader = req.headers.authorization
  const token = authHeader?.split(' ')[1]
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' })
  }

  // Use admin client to verify the token directly
  const { data: { user }, error: authError } = await supabase.auth.getUser(token)
  
  if (authError || !user) {
    return res.status(401).json({ 
      error: 'Invalid or expired token',
      details: authError?.message 
    })
  }

  const { title, description, price, image_url, category, stock_quantity, is_active } = req.body
  
  if (!title || !description || price === undefined) {
    return res.status(400).json({ 
      error: 'Missing required fields: title, description, price' 
    })
  }

  // Create the anon client with the user's token for the insert
  const supabaseWithAuth = createClient(
    supabaseUrl, 
    supabaseClientKey,
    {
      global: {
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    }
  )

  const newProduct = {
    seller_id: user.id,                    
    title: title,                        
    description: description,            
    price: parseFloat(price),            
    image_url: image_url || null,        
    category: category || null,     
    stock_quantity: stock_quantity || 0, 
    is_active: is_active !== undefined ? is_active : true
  }

  try {
    // Use the authenticated anon client for the insert
    const { data, error } = await supabaseWithAuth
      .from('products')
      .insert(newProduct)
      .select()

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to create product', 
        details: error.message 
      })
    }
    
    if (!data || data.length === 0) {
      return res.status(400).json({ 
        error: 'Product creation failed - no data returned' 
      })
    }
    
    res.status(201).json({
      message: 'Product created successfully',
      product: data[0]
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
})

// AUTHENTICATION ENDPOINTS
// Register new user
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      })
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      })
    }
      
    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: '',
          avatar_url: ''
        }
      }
    })
    
    if (error) {
      return res.status(400).json({ 
        error: 'Registration failed',
        details: error.message 
      })
    }
    
    res.status(201).json({
      message: 'Registration successful'
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})

// Login user
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body
    
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      })
    }
    
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    })
    
    if (error) {
      return res.status(401).json({ 
        error: 'Login failed',
        details: error.message 
      })
    }
    
    res.json({
      message: 'Login successful',
      user: {
        id: data.user?.id,
        email: data.user?.email,
        name: data.user?.user_metadata?.full_name || data.user?.email,
        avatar_url: data.user?.user_metadata?.avatar_url
      },
      session: data.session
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})

// Magic Link Login
app.post('/api/auth/magic-link', async (req, res) => {
  try {
    const { email } = req.body
    
    if (!email) {
      return res.status(400).json({ 
        error: 'Email is required' 
      })
    }
        
    const { data, error } = await supabase.auth.signInWithOtp({
      email: email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${FRONTEND_URL}/auth/callback`,
      }
    })
    
    if (error) {
      return res.status(400).json({ 
        error: 'Failed to send magic link',
        details: error.message 
      })
    }
    
    res.json({
      message: 'Magic link sent successfully',
      email: email
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})

// Google OAuth Login
app.post('/api/auth/google', async (req, res) => {
  try {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.FRONTEND_URL || 'http://localhost:5173'}/auth/callback`
      }
    })
    
    if (error) {
      return res.status(400).json({ 
        error: 'Failed to initiate Google login',
        details: error.message 
      })
    }
    
    res.json({
      message: 'Google OAuth initiated',
      redirectUrl: data.url
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})

// Get current session
app.get('/api/auth/session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }
    
    const { data: { user }, error } = await supabase.auth.getUser(token)
    
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    
    res.json({
      session: {
        access_token: token,
        user: user
      },
      user: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email,
        avatar_url: user.user_metadata?.avatar_url
      }
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})
// Add these cart API endpoints to your existing backend server

// Get user's cart items
app.get('/api/cart', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    // Get cart items with product details
    const { data, error } = await supabase
      .from('cart_items')
      .select(`
        *,
        products (
          id,
          title,
          description,
          price,
          image_url,
          category,
          stock_quantity,
          is_active
        )
      `)
      .eq('user_id', user.id)
      .order('added_at', { ascending: false })

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch cart items', 
        details: error.message 
      })
    }
    
    res.json(data || [])
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal error',
      details: err.message
    })
  }
})

// Add item to cart
app.post('/api/cart', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    const { product_id, quantity = 1 } = req.body
    
    if (!product_id) {
      return res.status(400).json({ 
        error: 'Product ID is required' 
      })
    }

    // First, check if product exists and is available
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, title, stock_quantity, is_active')
      .eq('id', product_id)
      .single()

    if (productError || !product) {
      return res.status(404).json({ 
        error: 'Product not found',
        details: productError?.message 
      })
    }

    if (!product.is_active) {
      return res.status(400).json({ 
        error: 'Product is not active' 
      })
    }

    if (product.stock_quantity < quantity) {
      return res.status(400).json({ 
        error: 'Insufficient stock',
        available: product.stock_quantity,
        requested: quantity
      })
    }

    // Check if item already exists in cart
    const { data: existingItem, error: existingError } = await supabase
      .from('cart_items')
      .select('*')
      .eq('user_id', user.id)
      .eq('product_id', product_id)
      .single()

    let result

    if (existingItem && !existingError) {
      // Update existing cart item
      const newQuantity = existingItem.quantity + quantity
      
      if (newQuantity > product.stock_quantity) {
        return res.status(400).json({ 
          error: 'Cannot add more items than available stock',
          currentInCart: existingItem.quantity,
          available: product.stock_quantity,
          requested: quantity
        })
      }

      const { data, error } = await supabase
        .from('cart_items')
        .update({ 
          quantity: newQuantity,
          added_at: new Date().toISOString()
        })
        .eq('id', existingItem.id)
        .select()

      if (error) {
        return res.status(400).json({ 
          error: 'Failed to update cart item', 
          details: error.message 
        })
      }

      result = data[0]
    } else {
      // Create new cart item
      const { data, error } = await supabase
        .from('cart_items')
        .insert({
          user_id: user.id,
          product_id: product_id,
          quantity: quantity
        })
        .select()

      if (error) {
        return res.status(400).json({ 
          error: 'Failed to add item to cart', 
          details: error.message 
        })
      }

      result = data[0]
    }
    
    res.status(201).json({
      message: `Added "${product.title}" to cart`,
      cartItem: result
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
})

// Update cart item quantity
app.put('/api/cart/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    const cartItemId = req.params.id
    const { quantity } = req.body
    
    if (!quantity || quantity < 1) {
      return res.status(400).json({ 
        error: 'Quantity must be at least 1' 
      })
    }

    // Verify cart item belongs to user and get product info
    const { data: cartItem, error: cartError } = await supabase
      .from('cart_items')
      .select(`
        *,
        products (
          stock_quantity,
          title
        )
      `)
      .eq('id', cartItemId)
      .eq('user_id', user.id)
      .single()

    if (cartError || !cartItem) {
      return res.status(404).json({ 
        error: 'Cart item not found',
        details: cartError?.message 
      })
    }

    if (quantity > cartItem.products.stock_quantity) {
      return res.status(400).json({ 
        error: 'Quantity exceeds available stock',
        available: cartItem.products.stock_quantity,
        requested: quantity
      })
    }

    // Update quantity
    const { data, error } = await supabase
      .from('cart_items')
      .update({ quantity })
      .eq('id', cartItemId)
      .select()

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update cart item', 
        details: error.message 
      })
    }
    
    res.json({
      message: `Updated quantity for "${cartItem.products.title}"`,
      cartItem: data[0]
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
})

// Remove item from cart
app.delete('/api/cart/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    const cartItemId = req.params.id

    // Verify cart item belongs to user
    const { data: cartItem, error: cartError } = await supabase
      .from('cart_items')
      .select('*, products(title)')
      .eq('id', cartItemId)
      .eq('user_id', user.id)
      .single()

    if (cartError || !cartItem) {
      return res.status(404).json({ 
        error: 'Cart item not found',
        details: cartError?.message 
      })
    }

    // Delete cart item
    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('id', cartItemId)

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to remove cart item', 
        details: error.message 
      })
    }
    
    res.json({
      message: `Removed "${cartItem.products.title}" from cart`
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
})

// Clear entire cart
app.delete('/api/cart', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    // Delete all cart items for user
    const { error } = await supabase
      .from('cart_items')
      .delete()
      .eq('user_id', user.id)

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to clear cart', 
        details: error.message 
      })
    }
    
    res.json({
      message: 'Cart cleared successfully'
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
})
// Logout user
app.post('/api/auth/logout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (token) {
      const { error } = await supabase.auth.signOut()
      
      if (error) {
        return res.status(400).json({ 
          error: 'Logout failed',
          details: error.message 
        })
      }
    }
    
    res.json({
      message: 'Logout successful'
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})

// Get user profile
app.get('/api/auth/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    
    let profileData = {}
    try {
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('username, website, avatar_url, google_id')
        .eq('id', user.id)
        .single()
      
      if (profile && !profileError) {
        profileData = profile
      }
    } catch (err) {
      // Profile table might not exist or user might not have a profile record
    }
    
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: profileData.username || user.user_metadata?.full_name || user.email,
        username: profileData.username || user.user_metadata?.full_name,
        website: profileData.website || '',
        avatar_url: profileData.avatar_url || user.user_metadata?.avatar_url,
        google_id: profileData.google_id || user.user_metadata?.provider_id,
        created_at: user.created_at,
        last_sign_in_at: user.last_sign_in_at,
        email_confirmed_at: user.email_confirmed_at
      }
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})

// Update user profile
app.put('/api/auth/profile', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }
    
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' })
    }
    
    const { username, name, website, avatar_url } = req.body
    
    if (username && username.length > 50) {
      return res.status(400).json({ error: 'Username too long (max 50 characters)' })
    }
    
    if (website && !isValidUrl(website)) {
      return res.status(400).json({ error: 'Invalid website URL' })
    }
    
    if (avatar_url && !isValidUrl(avatar_url)) {
      return res.status(400).json({ error: 'Invalid avatar URL' })
    }
    
    const updates = {
      id: user.id,
      username: username || name || user.email,
      website: website || '',
      avatar_url: avatar_url || '',
      updated_at: new Date().toISOString()
    }
    
    const { data, error } = await supabase
      .from('profiles')
      .upsert(updates, { 
        onConflict: 'id',
        returning: 'representation' 
      })
      .select()
    
    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update profile',
        details: error.message 
      })
    }
    
    try {
      await supabase.auth.updateUser({
        data: {
          full_name: username || name,
          avatar_url: avatar_url
        }
      })
    } catch (metaError) {
      // Continue anyway, profile table update is more important
    }
    
    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: updates.username,
        username: updates.username,
        website: updates.website,
        avatar_url: updates.avatar_url,
        updated_at: updates.updated_at
      }
    })
    
  } catch (err) {
    res.status(500).json({ 
      error: 'Internal server error',
      details: err.message 
    })
  }
})

// Helper function to validate URLs
function isValidUrl(string) {
  if (!string) return true
  
  try {
    const url = new URL(string)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch (err) {
    return false
  }
}
// Add this endpoint after your existing product endpoints and before the authentication endpoints

// Get current user's products (seller dashboard)
app.get('/api/my-products', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    // Get products created by this user
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .eq('seller_id', user.id)
      .order('created_at', { ascending: false })

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to fetch your products', 
        details: error.message 
      })
    }
    
    res.json({
      products: data || [],
      count: data?.length || 0,
      seller: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email
      }
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal error',
      details: err.message
    })
  }
})

// Update existing product (seller can edit their own products)
app.put('/api/my-products/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    const productId = req.params.id
    const { title, description, price, image_url, category, stock_quantity, is_active } = req.body

    // Verify the product belongs to this user
    const { data: existingProduct, error: checkError } = await supabase
      .from('products')
      .select('seller_id')
      .eq('id', productId)
      .single()

    if (checkError || !existingProduct) {
      return res.status(404).json({ 
        error: 'Product not found',
        details: checkError?.message 
      })
    }

    if (existingProduct.seller_id !== user.id) {
      return res.status(403).json({ 
        error: 'You can only edit your own products' 
      })
    }

    // Prepare update object (only include fields that are provided)
    const updates = {
      updated_at: new Date().toISOString()
    }

    if (title !== undefined) updates.title = title
    if (description !== undefined) updates.description = description
    if (price !== undefined) updates.price = parseFloat(price)
    if (image_url !== undefined) updates.image_url = image_url
    if (category !== undefined) updates.category = category
    if (stock_quantity !== undefined) updates.stock_quantity = parseInt(stock_quantity)
    if (is_active !== undefined) updates.is_active = is_active

    // Update the product
    const { data, error } = await supabase
      .from('products')
      .update(updates)
      .eq('id', productId)
      .eq('seller_id', user.id) // Double-check ownership
      .select()

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to update product', 
        details: error.message 
      })
    }

    if (!data || data.length === 0) {
      return res.status(404).json({ 
        error: 'Product not found or update failed' 
      })
    }
    
    res.json({
      message: 'Product updated successfully',
      product: data[0]
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
})

// Delete product (seller can delete their own products)
app.delete('/api/my-products/:id', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    const productId = req.params.id

    // Verify the product belongs to this user and get product info
    const { data: existingProduct, error: checkError } = await supabase
      .from('products')
      .select('seller_id, title')
      .eq('id', productId)
      .single()

    if (checkError || !existingProduct) {
      return res.status(404).json({ 
        error: 'Product not found',
        details: checkError?.message 
      })
    }

    if (existingProduct.seller_id !== user.id) {
      return res.status(403).json({ 
        error: 'You can only delete your own products' 
      })
    }

    // Check if product is in any carts before deleting
    const { data: cartItems, error: cartError } = await supabase
      .from('cart_items')
      .select('id')
      .eq('product_id', productId)

    if (cartError) {
      return res.status(400).json({ 
        error: 'Failed to check cart dependencies', 
        details: cartError.message 
      })
    }

    // If product is in carts, you might want to either:
    // 1. Prevent deletion
    // 2. Remove from carts first
    // For now, let's prevent deletion if it's in someone's cart
    if (cartItems && cartItems.length > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete product that is currently in customer carts',
        suggestion: 'Consider marking it as inactive instead'
      })
    }

    // Delete the product
    const { error } = await supabase
      .from('products')
      .delete()
      .eq('id', productId)
      .eq('seller_id', user.id) // Double-check ownership

    if (error) {
      return res.status(400).json({ 
        error: 'Failed to delete product', 
        details: error.message 
      })
    }
    
    res.json({
      message: `Product "${existingProduct.title}" deleted successfully`
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message
    })
  }
})

// Get seller statistics/dashboard data
app.get('/api/seller-stats', async (req, res) => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader?.split(' ')[1]
    
    if (!token) {
      return res.status(401).json({ error: 'No token provided' })
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return res.status(401).json({ 
        error: 'Invalid or expired token',
        details: authError?.message 
      })
    }

    // Get product statistics
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, is_active, stock_quantity, price, created_at')
      .eq('seller_id', user.id)

    if (productsError) {
      return res.status(400).json({ 
        error: 'Failed to fetch seller statistics', 
        details: productsError.message 
      })
    }

    // Calculate statistics
    const totalProducts = products.length
    const activeProducts = products.filter(p => p.is_active).length
    const inactiveProducts = totalProducts - activeProducts
    const outOfStockProducts = products.filter(p => p.stock_quantity === 0).length
    const totalValue = products.reduce((sum, p) => sum + (p.price * p.stock_quantity), 0)
    
    // Get recent products (last 7 days)
    const weekAgo = new Date()
    weekAgo.setDate(weekAgo.getDate() - 7)
    const recentProducts = products.filter(p => new Date(p.created_at) > weekAgo).length

    res.json({
      seller: {
        id: user.id,
        email: user.email,
        name: user.user_metadata?.full_name || user.email
      },
      statistics: {
        totalProducts,
        activeProducts,
        inactiveProducts,
        outOfStockProducts,
        recentProducts,
        totalInventoryValue: totalValue
      },
      summary: {
        message: `You have ${totalProducts} products, ${activeProducts} active`
      }
    })
    
  } catch (err) {
    return res.status(500).json({
      error: 'Internal error',
      details: err.message
    })
  }
})
// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Backend server is running',
    timestamp: new Date().toISOString(),
    endpoints: {
      products: {
        getAll: '/api/posts',
        create: 'POST /api/posts',
        myProducts: '/api/my-products',
        updateProduct: 'PUT /api/my-products/:id',
        deleteProduct: 'DELETE /api/my-products/:id',
        sellerStats: '/api/seller-stats'
      },
      cart: {
        getCart: '/api/cart',
        addToCart: 'POST /api/cart',
        updateItem: 'PUT /api/cart/:id',
        removeItem: 'DELETE /api/cart/:id',
        clearCart: 'DELETE /api/cart'
      },
      auth: {
        register: '/api/auth/register',
        login: '/api/auth/login',
        logout: '/api/auth/logout',
        magicLink: '/api/auth/magic-link',
        google: '/api/auth/google',
        session: '/api/auth/session',
        profile: '/api/auth/profile'
      }
    }
  })
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on port ${PORT}`)
  console.log(`📡 API endpoints available:`)
  console.log(`   📦 Products: http://localhost:${PORT}/api/posts`)
  console.log(`   🔐 Auth Register: http://localhost:${PORT}/api/auth/register`)
  console.log(`   🔑 Auth Login: http://localhost:${PORT}/api/auth/login`)
  console.log(`   ✨ Magic Link: http://localhost:${PORT}/api/auth/magic-link`)
  console.log(`   🔍 Google OAuth: http://localhost:${PORT}/api/auth/google`)
  console.log(`   ❤️ Health Check: http://localhost:${PORT}/api/health`)
})