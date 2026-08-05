"use strict";

const SEARCH_PRODUCTS_QUERY = `query searchProducts($input: SearchProductInput!) {
  searchProducts(input: $input) {
    ... on ListSearchProductResponse {
      total
      perPage
      currentPage
      lastPage
      items {
        id
        type
        isActive
        images
        isPreOrder
        isRegionPrice
        isSellerUMKK
        labels
        isWholesale
        defaultPrice
        defaultPriceWithTax
        createdAt
        maxPrice
        maxPriceWithTax
        minPrice
        minPriceWithTax
        ppnBmPercentage
        ppnPercentage
        tkdn {
          value
          bmpValue
          tkdnBmp
          status
        }
        location {
          name
          regionCode
          child {
            name
            regionCode
            child {
              name
              regionCode
              child {
                name
                regionCode
              }
            }
          }
        }
        name
        stockAvailability
        stockAccumulation
        sellerName
        sellerId
        score
        scoreDetail {
          keywordScore
          locationScore
          priceScore
          ratingScore
          tkdnScore
          umkkScore
          unitSoldScore
        }
        unitSold
        username
        slug
        rating {
          count
          average
        }
        variants {
          id
          isActive
          options {
            name
            value
          }
          price
          priceWithTax
          sortOrder
          stock
        }
        status
        brand {
          brandName
          status
        }
        category {
          isActive
          name
          id
        }
      }
    }
    ... on GenericError {
      __typename
      reqId
      message
      code
    }
  }
}`;

const GET_PRODUCT_BY_SLUG_QUERY = `query getProductBySlug($_v0_username: String!, $_v0_slug: String!, $_v0_regionCode: String, $_v1_input: SellerScoreInput!) {
  _v0_getProductBySlug: getProductBySlug(slug: $_v0_slug, username: $_v0_username) {
    ... on Product {
      id
      prices(regionCode: $_v0_regionCode) {
        isRegionPrice
        minPurchase
        minPriceWithTax
        maxPrice
        maxPriceWithTax
        productWholesalePrices {
          id
          minQuantity
          price
          priceWithTax
          taxablePrice
        }
        selectedRegionPrice {
          id
          parentRegionCode
          price
          regionCode
          regionLevel
          regionName
          priceWithTax
          taxablePrice
        }
      }
      brand {
        applicationNumber
        brandName
        expirationDate
        fillingDate
        ownerName
        registrationNumber
        statusName
        url
        status
      }
      category {
        id
        isActive
        name
        curationEnabled
        allowedTransactionMethod
      }
      categoryType
      description
      id
      images {
        id
        imageUrl
      }
      isActive
      kbki
      masterProductId
      labels
      name
      pdn {
        laborType
        locationType
        materialType
        type
        countryCode
        countryName
      }
      preOrder {
        sla
      }
      productAddOns {
        description
        id
        name
        type
        productAddOnVariants {
          description
          id
          name
          price
          priceWithTax
          taxablePrice
        }
        tax {
          ppnPercentage
          ppnTypes
        }
      }
      productInformations {
        additionalInformations {
          name
          value
          id
          customFormFieldId
        }
        documents {
          customFormFieldId
          id
          name
          value
        }
        mainInformations {
          customFormFieldId
          id
          name
          value
        }
      }
      productOptions {
        id
        option
        valueIds
        optionLevel
        values
      }
      sellerId
      shipping {
        dimensionUnit
        hasSellerShipping
        height
        length
        weight
        weightUnit
        width
      }
      slug
      sni {
        accreditationScheme
        brand
        certificateNumber
        certificationScheme
        companyName
        expirationDate
        productName
        publishedDate
        sniNumber
        url
        spptNumber
        status
      }
      status
      stockUnit {
        primaryUnit
        secondaryUnit
        value
      }
      tkdn {
        bmpDate
        bmpExpirationDate
        bmpValue
        brand
        companyName
        date
        email
        hs
        description
        expirationDate
        number
        producerName
        productType
        specificationId
        standard
        type
        url
        value
        score
        status
      }
      construction {
        code
        descriptions
        id
        isSmkk
        isUmum
        jobType
        materials {
          code
          coefficient
          formulaCoefficient
          id
          inputCoefficient
          name
          orderNumber
          price
          unit
        }
        name
        referenceType
        unit
        tools {
          code
          coefficient
          formulaCoefficient
          id
          inputCoefficient
          name
          orderNumber
          price
          unit
        }
        workerPackages {
          code
          coefficient
          formulaCoefficient
          id
          inputCoefficient
          name
          orderNumber
          price
          unit
        }
      }
      type
      username
      updatedAt
      variants {
        id
        imageUrl
        isActive
        optionValues
        options
        price
        taxablePrice
        priceWithTax
        sku
        sortOrder
        stock
        priceWithTax
      }
      videoSource
      videoUrl
      unitSold
      sellerLocation {
        paramId
        cityName
        isFTZ
      }
      tax {
        ppnBmPercentage
        ppnBmType
        ppnBmTaxPaymentFileToken
        ppnBmTaxPaymentStatus
        ppnBmId
        ppnPercentage
        ppnTypes
        taxableRate
      }
      actionReasons {
        enum
        reason
        description
      }
      actionReasonsActor {
        klpdCode
        klpdDescription
      }
      rating {
        count
        average
      }
      additionalFee {
        isActive
      }
      consolidation {
        name
        pricingScheme
      }
      subType
      book {
        referenceId
      }
      kfa {
        active
        kfaCode
        packageKfaCode
      }
      extraLabels {
        id
        label
        expiredAt
        info {
          key
          value
        }
      }
      hasDecimalQuantity
      isAllowedBuyer
    }
    ... on GenericError {
      __typename
      code
      message
      reqId
    }
  }
  _v1_sellerScore: sellerScore(input: $_v1_input) {
    ... on SellerScoreResponse {
      details {
        componentName
        notes
        score
        value
        valueUnit
        weightPercentage
      }
      finalScore
      orderSignedCount
    }
    ... on GenericError {
      __typename
      code
      message
      reqId
    }
  }
}`;

module.exports = { SEARCH_PRODUCTS_QUERY, GET_PRODUCT_BY_SLUG_QUERY };
